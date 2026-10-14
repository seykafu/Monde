import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(url?: string) {
  if (!url) return undefined;
  // postgres.js opens connections only when a query is issued.
  const client = postgres(url, { connect_timeout: 2, max: 5, idle_timeout: 20,
    connection: { statement_timeout: 2000 } });
  return { client, db: drizzle(client, { schema }) };
}
