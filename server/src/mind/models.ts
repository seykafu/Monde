import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { meta } from '../db/schema.js';

export const MODEL_IDS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'] as const;
export const ModelIdSchema = z.enum(MODEL_IDS);
export type ModelId = z.infer<typeof ModelIdSchema>;
export const MODEL_ROLES = ['dialogue', 'precheck', 'plan', 'reflect', 'gossip', 'press', 'arrival', 'summary'] as const;
export const ModelRoleSchema = z.enum(MODEL_ROLES);
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type ThinkingOff = 'disabled' | 'between_tools' | 'always_on';
export const DEFAULT_MODEL: ModelId = 'claude-haiku-5-5';
export interface ModelDefinition {
  id: ModelId; label: string; tier: 'slm' | 'llm'; input: number; output: number;
  cacheReadFactor: number; cacheWriteFactor: number; thinkingOff: ThinkingOff;
}
/** October 2026 prices; Haiku's base tier assumes prompts <= 100K tokens. */
export const MODELS: readonly ModelDefinition[] = [
  { id: DEFAULT_MODEL, label: 'Claude Haiku 5.5', tier: 'slm', input: .1, output: .5, cacheReadFactor: .1, cacheWriteFactor: 1.25, thinkingOff: 'disabled' },
  { id: MODEL_IDS[1], label: 'Claude Sonnet 5.5', tier: 'llm', input: 2, output: 10, cacheReadFactor: .05, cacheWriteFactor: 1.25, thinkingOff: 'between_tools' },
  { id: MODEL_IDS[2], label: 'Claude Opus 5.5', tier: 'llm', input: 4, output: 20, cacheReadFactor: .05, cacheWriteFactor: 1.25, thinkingOff: 'always_on' },
  { id: MODEL_IDS[3], label: 'Claude Fable 5.1', tier: 'llm', input: 10, output: 50, cacheReadFactor: .025, cacheWriteFactor: 1.25, thinkingOff: 'always_on' },
];
export function modelDefinition(id: string): ModelDefinition {
  const model = MODELS.find(m => m.id === id);
  if (!model) throw new Error(`Unknown mind model: ${id}`);
  return model;
}
const Overrides = z.partialRecord(ModelRoleSchema, ModelIdSchema);
type Overrides = z.infer<typeof Overrides>;
export class ModelRoutingUnavailableError extends Error {}
export type CapabilityProbe = (id: string) => Promise<unknown>;
const Capabilities = z.object({ capabilities: z.object({ thinking: z.object({ types: z.object({
  disabled: z.object({ supported: z.boolean() }), between_tools: z.object({ supported: z.boolean() }),
}) }) }) });

/** One router per application/database; no process-global mutable routing or network waits in request builders. */
export class ModelRouter {
  private overrides: Overrides = {};
  private strategies = new Map<ModelId, ThinkingOff>();
  private probing = new Set<ModelId>();
  private failures = new Set<ModelId>();
  private refreshVersion = 0;
  private retryAfter = new Map<ModelId, number>();
  constructor(private readonly config: Partial<Config> = {}, private readonly db?: WorldDatabase, private readonly probe?: CapabilityProbe) {
    for (const key of ['MIND_MODEL', ...MODEL_ROLES.map(r => `MIND_MODEL_${r.toUpperCase()}`)]) {
      const value = (config as Record<string, unknown>)[key];
      if (value !== undefined) ModelIdSchema.parse(value);
    }
  }
  resolve(role: ModelRole): { model: ModelId; source: 'admin' | 'env' | 'default' } {
    const env = ((this.config as Record<string, unknown>)[`MIND_MODEL_${role.toUpperCase()}`] ?? this.config.MIND_MODEL) as ModelId | undefined;
    const model = this.overrides[role] ?? env ?? DEFAULT_MODEL;
    this.confirm(model);
    return { model, source: this.overrides[role] ? 'admin' : env ? 'env' : 'default' };
  }
  strategy(model: ModelId): ThinkingOff { this.confirm(model); return this.strategies.get(model) ?? modelDefinition(model).thinkingOff; }
  private confirm(model: ModelId): void {
    if (!this.probe || this.strategies.has(model) || this.probing.has(model) || Date.now() < (this.retryAfter.get(model) ?? 0)) return;
    this.probing.add(model);
    void Promise.resolve().then(() => this.probe!(model)).then(answer => {
      const types = Capabilities.parse(answer).capabilities.thinking.types;
      this.strategies.set(model, types.disabled.supported ? 'disabled' : types.between_tools.supported ? 'between_tools' : 'always_on');
    }).catch(() => {
      // A failed startup lookup gets one immediate lazy retry; repeated failures back off for a minute.
      this.retryAfter.set(model, this.failures.has(model) ? Date.now() + 60_000 : 0);
      this.failures.add(model);
    }).finally(() => this.probing.delete(model));
  }
  async refresh(): Promise<void> {
    const version = ++this.refreshVersion;
    if (this.db) {
      const [row] = await this.db.select().from(meta).where(eq(meta.key, 'model-routing')).catch(cause => {
        for (const role of MODEL_ROLES) this.resolve(role);
        throw new ModelRoutingUnavailableError('Cannot read model routing overrides', { cause });
      });
      const next = Overrides.parse(row?.value ? JSON.parse(row.value) : {});
      if (version !== this.refreshVersion) return;
      this.overrides = next;
    }
    for (const role of MODEL_ROLES) this.resolve(role);
  }
  async set(role: ModelRole, model: ModelId | null): Promise<void> {
    if (!this.db) throw new Error('database unavailable');
    await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('model-routing'))`);
      const [row] = await tx.select().from(meta).where(eq(meta.key, 'model-routing'));
      const next = Overrides.parse(row?.value ? JSON.parse(row.value) : {});
      if (model === null) delete next[role]; else next[role] = model;
      await tx.insert(meta).values({ key: 'model-routing', value: JSON.stringify(next) }).onConflictDoUpdate({ target: meta.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
    });
    await this.refresh();
  }
  status() {
    return { roles: Object.fromEntries(MODEL_ROLES.map(role => [role, this.resolve(role)])),
      models: MODELS.map(({ id, label, tier, input, output }) => ({ id, label, tier, input, output })) };
  }
}
export const defaultRouter = new ModelRouter();
const routers = new WeakMap<object, ModelRouter>();
export function bindModelRouter(db: WorldDatabase, router: ModelRouter): void { routers.set(db, router); }
export const routerFor = (db?: WorldDatabase): ModelRouter => db ? routers.get(db) ?? defaultRouter : defaultRouter;

/** Preserve legacy field order/body by default, changing only model-dependent settings. */
export function modelParams<T extends Anthropic.MessageCreateParamsNonStreaming>(
  role: ModelRole, params: T, router = defaultRouter, selected = router.resolve(role).model,
): T {
  const result = { ...params, model: selected };
  const strategy = router.strategy(selected);
  if (params.thinking?.type === 'disabled') {
    if (strategy === 'disabled') result.thinking = { type: 'disabled' };
    else {
      if (strategy === 'between_tools') result.thinking = { type: 'between_tools' };
      else delete result.thinking;
      result.output_config = { ...params.output_config, effort: 'low' };
    }
  } else if (strategy === 'always_on') result.output_config = { ...params.output_config, effort: 'low' };
  return result;
}
