CREATE TABLE "arrivals" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"status" text NOT NULL,
	"archetype" text NOT NULL,
	"draw" jsonb NOT NULL,
	"cards" jsonb NOT NULL,
	"dream_templates" text[] NOT NULL,
	"summary" text NOT NULL,
	"source" text NOT NULL,
	"created_day" integer NOT NULL,
	"arrival_day" integer,
	"home" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arrivals_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arrivals_world_status_idx" ON "arrivals" USING btree ("world_id","status");