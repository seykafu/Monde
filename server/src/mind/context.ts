/**
 * Context assembly for a dialogue turn (GDD §9.10.1, §9.6; MVP M-05). Loads what the prompt builder needs from
 * the world's rows: the card, state and relationships (blocks 2-3), retrieved memories, topic cards, open favors,
 * the conversation so far and the resident's recent lines for the echo check.
 *
 * The prompt itself is built by promptBuilder.ts; nothing here formats text for the model.
 */
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  FavorTemplate, type Memory, type PersonaCard, type ResidentState,
} from "@monde/shared";
import { dialogueTurns, events, favors, memories, relationships, residents, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import {
  revealableSecrets, systemBlocks, type CanonContext, type ConversationTurn, type DialogueInput, type OpenFavorView,
  type RelationshipView,
} from "./promptBuilder.js";
import { playerView, type PlayerProfile } from "./player.js";
import { contentWords, retrieveMemories, topicCards, type MemoryCandidate } from "./retrieval.js";
import { riddleRecord, riddleTopic, type RiddleRecord } from "./riddles.js";
import { ECHO_WINDOW, type ValidationContext } from "./validate.js";

/** The scene the client reports with each turn. The client owns the clock, position and weather. */
export interface TalkScene {
  day: number;
  minute: number;
  place: string;
  weather: string;
  current_activity?: string | null;
  riddle?: { id: string; hints_allowed: number } | null;
}

/** Everything that feeds prompt blocks 1-3. Prewarm and dialogue build it the same way so the bytes match. */
export interface ResidentPrefix {
  card: PersonaCard;
  state: ResidentState;
  relationships: RelationshipView[];
  /** World story flags synced by M-06; shared by prewarm and dialogue. */
  flags: string[];
  /** Display names by resident id (stable: from the cards). */
  names: Record<string, string>;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Day 1 is the Tuesday the ferry brings the Fellow (§3.2, §5.3: the ferry runs Tue and Fri; the client agrees). */
const DAY_ONE_WEEKDAY = 1;
export function weekdayOf(day: number): string {
  return WEEKDAYS[(((day - 1 + DAY_ONE_WEEKDAY) % 7) + 7) % 7]!;
}

export async function loadResidentPrefix(db: WorldDatabase, worldId: string, residentId: string): Promise<ResidentPrefix | null> {
  const [row] = await db.select().from(residents).where(and(eq(residents.worldId, worldId), eq(residents.id, residentId)));
  if (!row) return null;
  const [worldRows, edges, everyone] = await Promise.all([
    db.select({ flags: worlds.storyFlags }).from(worlds).where(eq(worlds.id, worldId)),
    db.select().from(relationships).where(and(eq(relationships.worldId, worldId), eq(relationships.fromId, residentId))),
    db.select({ id: residents.id, name: sql<string>`${residents.card}->>'name'` }).from(residents).where(eq(residents.worldId, worldId)),
  ]);
  const names: Record<string, string> = {};
  for (const r of [...everyone].sort((a, b) => (a.id < b.id ? -1 : 1))) names[r.id] = r.name;
  return {
    card: row.card,
    state: row.state,
    relationships: edges.map((e) => ({
      id: e.toId, affinity: e.affinity, trust: e.trust, tag: e.tag,
      feeling: e.feelingKind ? { kind: e.feelingKind as NonNullable<RelationshipView["feeling"]>["kind"], intensity: e.feelingIntensity } : null,
    })),
    flags: worldRows[0]?.flags ?? [],
    names,
  };
}

export function canonContext(prefix: ResidentPrefix, day: number): CanonContext {
  return { flags: prefix.flags, day, names: prefix.names };
}

/** Blocks 1-3 exactly as a dialogue turn on `day` sends them. */
export function prefixSystemBlocks(prefix: ResidentPrefix, day: number) {
  return systemBlocks(prefix.card, prefix.state, prefix.relationships, canonContext(prefix, day));
}

export interface DialogueContext {
  prefix: ResidentPrefix;
  /** Ready for buildDialogueRequest. */
  input: DialogueInput;
  validation: ValidationContext;
  /** 0-based exchange number of this turn within the conversation. */
  turnIndex: number;
  riddle: { record: RiddleRecord; allowed: number } | null;
  playerName: string;
}

export type DialogueContextResult =
  | { ok: true; context: DialogueContext }
  | { ok: false; error: "unknown_resident" | "conversation_mismatch" };

export interface DialogueContextArgs {
  worldId: string;
  residentId: string;
  conversationId: string;
  scene: TalkScene;
  /** What goes in <player_said>. */
  playerSaid: string;
  /** The player's own words this turn (null when they just walked up), for retrieval relevance. */
  playerText: string | null;
}

/** How many memories to score per turn: the newest N, which is plenty for the 8 that make the prompt. */
const MEMORY_SCAN_LIMIT = 200;
/** §9.9: a favor is live while proposed (awaiting M-09 feasibility) or open. */
export const LIVE_FAVOR_STATUSES = ["proposed", "open"] as const;

/** Resident ids whose id or first name appears in the player's words. */
function mentionedResidents(text: string, names: Record<string, string>): string[] {
  const words = new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
  return Object.entries(names)
    .filter(([id, name]) => words.has(id) || name.replace(/"/g, " ").toLowerCase().split(/\s+/).some((part) => part.length > 2 && words.has(part)))
    .map(([id]) => id);
}

export async function loadDialogueContext(db: WorldDatabase, args: DialogueContextArgs): Promise<DialogueContextResult> {
  const { worldId, residentId, conversationId, scene } = args;
  const prefix = await loadResidentPrefix(db, worldId, residentId);
  if (!prefix) return { ok: false, error: "unknown_resident" };

  const [world] = await db.select({ player: worlds.player }).from(worlds).where(eq(worlds.id, worldId));
  const turns = await db.select().from(dialogueTurns)
    .where(and(eq(dialogueTurns.worldId, worldId), eq(dialogueTurns.conversationId, conversationId)))
    .orderBy(asc(dialogueTurns.turnIndex));
  if (turns.some((t) => t.residentId !== residentId)) return { ok: false, error: "conversation_mismatch" };

  const [memoryRows, favorRows, recentRows] = await Promise.all([
    db.select().from(memories)
      .where(and(eq(memories.worldId, worldId), eq(memories.residentId, residentId), eq(memories.archived, false)))
      .orderBy(desc(memories.day), desc(memories.minute)).limit(MEMORY_SCAN_LIMIT),
    db.select().from(favors).where(and(
      eq(favors.worldId, worldId), inArray(favors.status, [...LIVE_FAVOR_STATUSES]),
      or(eq(favors.residentId, residentId), eq(favors.target, residentId)),
    )),
    db.select({ output: dialogueTurns.output }).from(dialogueTurns)
      .where(and(eq(dialogueTurns.worldId, worldId), eq(dialogueTurns.residentId, residentId), eq(dialogueTurns.fallback, false)))
      .orderBy(desc(dialogueTurns.createdAt), desc(dialogueTurns.turnIndex)).limit(ECHO_WINDOW),
  ]);
  const sourceIds = [...new Set(memoryRows.map((m) => m.sourceEvent).filter((id): id is string => !!id))];
  const eventRows = await db.select().from(events).where(and(
    eq(events.worldId, worldId),
    sourceIds.length ? or(eq(events.day, scene.day), inArray(events.id, sourceIds)) : eq(events.day, scene.day),
  ));
  const tagsByEvent = new Map(eventRows.map((e) => [e.id, e.tags]));

  const memoryList: MemoryCandidate[] = memoryRows.map((m) => ({
    memory: {
      id: m.id, resident_id: m.residentId, day: m.day, minute: m.minute, kind: m.kind as Memory["kind"], text: m.text,
      who: m.who, where: m.wherePlace, importance: m.importance, valence: m.valence,
      ...(m.sourceEvent ? { source_event: m.sourceEvent } : {}),
    },
    tags: m.sourceEvent ? tagsByEvent.get(m.sourceEvent) ?? [] : [],
  }));

  const riddle = scene.riddle ? riddleRecord(scene.riddle.id) : null;
  const riddleState = riddle && scene.riddle ? { record: riddle, allowed: scene.riddle.hints_allowed } : null;
  const playerText = args.playerText ?? "";
  const terms = contentWords([playerText, scene.current_activity ?? "", scene.weather].join(" "));
  if (riddle) { terms.add("riddle"); terms.add(riddle.id.toLowerCase()); }
  const retrieved = retrieveMemories(memoryList, {
    today: scene.day,
    who: new Set(["player", ...mentionedResidents(playerText, prefix.names)]),
    place: scene.place,
    terms,
  });

  const ownFavors = favorRows.filter((f) => f.residentId === residentId);
  const topics = topicCards({
    today: scene.day,
    place: scene.place,
    memories: memoryList.map((c) => c.memory),
    favors: ownFavors,
    dream: prefix.card.dream.text,
    events: eventRows.filter((e) => e.day === scene.day).map((e) => ({ summary: e.summary, where: e.wherePlace, importance: e.importance })),
    weather: scene.weather,
    activity: scene.current_activity,
    recentTopics: prefix.state.recent_topics,
  });

  const openFavors: OpenFavorView[] = favorRows.flatMap((f) => {
    const template = FavorTemplate.safeParse(f.template);
    return template.success ? [{ owner: f.residentId, template: template.data, target: f.target, text: f.text }] : [];
  });

  const conversation: ConversationTurn[] = turns.flatMap((t) => [
    ...(t.playerInput ? [{ speaker: "player" as const, text: t.playerInput }] : []),
    ...t.output.lines.map((line) => ({ speaker: "resident" as const, text: line.text })),
  ]);

  const recentLines = recentRows.flatMap((r) => [...r.output.lines].reverse().map((line) => line.text)).slice(0, ECHO_WINDOW);
  const player = playerView(world?.player as PlayerProfile | null | undefined);
  const revealable = new Set(revealableSecrets(prefix.card, { regard: prefix.state.regard, flags: prefix.flags, day: scene.day }).map((s) => s.id));

  return {
    ok: true,
    context: {
      prefix,
      turnIndex: turns.length,
      riddle: riddleState,
      playerName: player.name,
      input: {
        card: prefix.card,
        state: prefix.state,
        relationships: prefix.relationships,
        flags: prefix.flags,
        names: prefix.names,
        scene: { day: scene.day, weekday: weekdayOf(scene.day), minute: scene.minute, place: scene.place, weather: scene.weather },
        doing: scene.current_activity ?? null,
        player,
        memories: retrieved,
        topics,
        openFavors,
        riddle: riddleState ? riddleTopic(riddleState.record, riddleState.allowed) : null,
        conversation,
        playerSaid: args.playerSaid,
        whimSeed: null,
      },
      validation: {
        card: prefix.card,
        emotion: prefix.state.mood.emotion,
        revealable,
        riddle,
        recentLines,
        heartPerk: false,
      },
    },
  };
}
