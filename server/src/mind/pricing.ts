/**
 * Claude Haiku 5.5 prices for cost logging (GDD §9.15, cached October 2026; re-check live before committing a
 * budget). Prompts here are always ≤ 100K tokens, so the base tier applies.
 */
export const HAIKU_55_PRICES_PER_MTOK = {
  input: 0.10,
  output: 0.50,
  /** Cache reads are 0.1× input. */
  cacheRead: 0.01,
  /** 5-minute cache writes are 1.25× input. */
  cacheWrite: 0.125,
} as const;

/** Token counts for one call, as reported in `usage` (input_tokens is the uncached remainder only). */
export interface CallTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_TOKENS: CallTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const BATCH_FACTOR = 0.5;

export function costUsd(tokens: CallTokens, prices = HAIKU_55_PRICES_PER_MTOK, factor = 1): number {
  return (tokens.input * prices.input + tokens.output * prices.output
    + tokens.cacheRead * prices.cacheRead + tokens.cacheWrite * prices.cacheWrite) / 1_000_000 * factor;
}

/** For the `ai_log.cost_usd` numeric column: ten decimals keeps a single cache-read token visible. */
export const formatUsd = (usd: number): string => usd.toFixed(10);
