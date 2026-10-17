CREATE TABLE "budget_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"kind" text NOT NULL,
	"cost_usd" numeric NOT NULL,
	"pending" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reported_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"conversation_id" text NOT NULL,
	"turn_index" integer NOT NULL,
	"resident_id" text NOT NULL,
	"lines" jsonb NOT NULL,
	"player_input" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_calls" ADD CONSTRAINT "budget_calls_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_turns" ADD CONSTRAINT "reported_turns_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_calls_day_idx" ON "budget_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "budget_calls_world_idx" ON "budget_calls" USING btree ("world_id","day");--> statement-breakpoint
CREATE INDEX "reported_turns_world_idx" ON "reported_turns" USING btree ("world_id","created_at");