ALTER TABLE "residents" ADD COLUMN "last_reflection_day" integer;--> statement-breakpoint
CREATE TABLE "reflection_batches" (
 "custom_id" uuid PRIMARY KEY NOT NULL,
 "world_id" uuid NOT NULL REFERENCES "worlds"("id") ON DELETE CASCADE,
 "resident_id" text NOT NULL, "day" integer NOT NULL, "batch_id" text,
 "status" text DEFAULT 'submitting' NOT NULL,
 "reservation_id" uuid NOT NULL REFERENCES "budget_calls"("id"),
 "reservation_usd" numeric NOT NULL, "prepared" jsonb NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "settled_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "reflection_batches_pending_idx" ON "reflection_batches" ("settled_at", "world_id");
