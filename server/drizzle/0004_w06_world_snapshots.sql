ALTER TABLE "snapshots" ADD COLUMN "minute" integer;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "checkpoint" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "parent_world_id" uuid;