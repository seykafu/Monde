import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export async function createTestDatabase() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)) });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
