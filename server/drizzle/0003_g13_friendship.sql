CREATE TABLE "tie_milestones" (
	"world_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_label" text NOT NULL,
	"to_label" text NOT NULL,
	CONSTRAINT "tie_milestones_world_id_day_a_id_b_id_pk" PRIMARY KEY("world_id","day","a_id","b_id")
);
--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "net_day" integer;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "net" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "encounters" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "residents" ADD COLUMN "talk_day" integer;--> statement-breakpoint
ALTER TABLE "residents" ADD COLUMN "talk_gain" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "residents" ADD COLUMN "last_talk_day" integer;--> statement-breakpoint
ALTER TABLE "tie_milestones" ADD CONSTRAINT "tie_milestones_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;