import { fileURLToPath } from "node:url";
import { parseConfig } from "../config.js";

const url = parseConfig().DATABASE_URL;
if (!url) {
  console.info("DATABASE_URL is unset; skipping migrations.");
} else {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { createDatabase } = await import("./client.js");
  const database = createDatabase(url)!;
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    });
    console.info("Database migrations complete.");
  } finally {
    await database.client.end({ timeout: 2 });
  }
}
