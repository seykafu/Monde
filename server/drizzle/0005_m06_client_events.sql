CREATE TABLE "processed_client_events" (
	"world_id" uuid NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "processed_client_events_world_id_key_pk" PRIMARY KEY("world_id","key")
);
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "story_flags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "flags_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_client_events" ADD CONSTRAINT "processed_client_events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;