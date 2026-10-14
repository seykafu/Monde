import { z } from "zod";

/** Episodic memory (GDD §9.6) and town events (§9.12). */

export const MemoryKind = z.enum(["saw", "heard", "did", "said", "felt", "scripted"]);

export const Memory = z.object({
  id: z.string(),
  resident_id: z.string(),
  day: z.number().int().min(1),
  minute: z.number().int().min(0).max(1560),
  kind: MemoryKind,
  text: z.string().max(200),
  who: z.array(z.string()),
  where: z.string(),
  importance: z.number().int().min(1).max(10),
  valence: z.number().int().min(-5).max(5),
  source_event: z.string().optional(),
});
export type Memory = z.infer<typeof Memory>;

export const TownEvent = z.object({
  id: z.string(),
  day: z.number().int().min(1),
  minute: z.number().int().min(0).max(1560),
  type: z.string(),
  where: z.string(),
  who: z.array(z.string()),
  importance: z.number().int().min(1).max(10),
  tags: z.array(z.string()),
  summary: z.string().max(240),
});
export type TownEvent = z.infer<typeof TownEvent>;

/** Retrieval score (GDD §9.6): 0.5·relevance + 0.3·importance/10 + 0.2·recency, recency half-life 5 days. */
export function memoryScore(m: Pick<Memory, "importance" | "day">, relevance: number, today: number): number {
  const recency = Math.pow(0.5, (today - m.day) / 5);
  return 0.5 * relevance + 0.3 * (m.importance / 10) + 0.2 * recency;
}
