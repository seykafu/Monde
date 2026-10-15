/** GDD §9.10.3, D18. Game minutes, never wall-clock time. */
export const RESUME_WINDOW = 5;
export const MAX_EXCHANGES = 6;
export const RESUME_EXCHANGES = 2;
export const MAX_SESSION_EXCHANGES = MAX_EXCHANGES + RESUME_EXCHANGES;
export const SUMMARY_WORDS = 60;
export const HISTORY_WORDS = 150;
export const RECENT_SUMMARIES = 6;
export const DIGEST_BATCH = 4;
// GDD-GAP: bounded summary metadata and optional-background-call policy (§9.10.3 implementation decisions).
export const SUMMARY_FACT_LIMIT = 6;
export const SUMMARY_FACT_WORDS = 30;
export const SUMMARY_TOPIC_WORDS = 10;
export const SUMMARY_FEELING_WORDS = 20;
export const SUMMARY_MEMORY_IMPORTANCE = 3;
export const SUMMARY_BUDGET_USD = 0.06;
export const SUMMARY_MAX_TOKENS = 900;
export const SUMMARY_TIMEOUT_MS = 12000;
