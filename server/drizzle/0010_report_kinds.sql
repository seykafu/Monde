ALTER TABLE "reported_turns" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reported_turns" ALTER COLUMN "turn_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reported_turns" ALTER COLUMN "resident_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reported_turns" ALTER COLUMN "lines" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "kind" text DEFAULT 'dialogue' NOT NULL;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "day" integer;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "story_index" integer;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "letter_id" text;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD COLUMN "text" text;