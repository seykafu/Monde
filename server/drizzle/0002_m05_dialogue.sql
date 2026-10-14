ALTER TABLE "dialogue_turns" ADD COLUMN "turn_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "player" jsonb;--> statement-breakpoint
CREATE INDEX "dialogue_turns_world_conversation_idx" ON "dialogue_turns" USING btree ("world_id","conversation_id");--> statement-breakpoint
CREATE INDEX "dialogue_turns_world_resident_created_idx" ON "dialogue_turns" USING btree ("world_id","resident_id","created_at");