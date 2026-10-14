import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
