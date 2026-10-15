import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Connection options for a Postgres URL. Supabase (D19) needs TLS, and its transaction pooler (Supavisor,
 * port 6543) can't keep prepared statements or accept startup parameters, so those are off there.
 * GDD-GAP: pooled connections have no per-statement timeout yet; a role-level statement_timeout would add one.
 */
export function connectionOptions(url: string): postgres.Options<Record<string, never>> {
  const { hostname, port, searchParams } = new URL(url);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".internal") || hostname.endsWith(".flycast");
  const pooled = port === "6543" || (hostname.includes("pooler.supabase.com") && port !== "5432");
  return {
    connect_timeout: 5, max: 5, idle_timeout: 20,
    ...(searchParams.has("sslmode") || local ? {} : { ssl: "require" as const }),
    ...(pooled ? { prepare: false } : { connection: { statement_timeout: 2000 } }),
  };
}

export function createDatabase(url?: string) {
  if (!url) return undefined;
  // postgres.js opens connections only when a query is issued.
  const client = postgres(url, connectionOptions(url));
  return { client, db: drizzle(client, { schema }) };
}
