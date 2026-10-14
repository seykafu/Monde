CREATE TABLE "ai_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"world_id" uuid,
	"kind" text NOT NULL,
	"resident_id" text,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"cached_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric NOT NULL,
	"latency_ms" integer NOT NULL,
	"first_token_ms" integer,
	"stop_reason" text NOT NULL,
	"validation" text NOT NULL,
	"fallback" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogue_turns" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"resident_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"day" integer NOT NULL,
	"minute" integer NOT NULL,
	"player_input" text,
	"output" jsonb NOT NULL,
	"fallback" boolean NOT NULL,
	CONSTRAINT "dialogue_turns_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"day" integer NOT NULL,
	"minute" integer NOT NULL,
	"type" text NOT NULL,
	"where_place" text NOT NULL,
	"who" text[] NOT NULL,
	"importance" integer NOT NULL,
	"tags" text[] NOT NULL,
	"summary" text NOT NULL,
	CONSTRAINT "events_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "favors" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"resident_id" text NOT NULL,
	"template" text NOT NULL,
	"target" text NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"created_day" integer NOT NULL,
	"expires_day" integer NOT NULL,
	"reward" jsonb NOT NULL,
	CONSTRAINT "favors_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"day" integer NOT NULL,
	"text" text NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	CONSTRAINT "letters_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"resident_id" text NOT NULL,
	"day" integer NOT NULL,
	"minute" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"who" text[] NOT NULL,
	"where_place" text NOT NULL,
	"importance" integer NOT NULL,
	"valence" integer NOT NULL,
	"source_event" text,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "memories_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"world_id" uuid NOT NULL,
	"resident_id" text NOT NULL,
	"day" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"source" text NOT NULL,
	"prompt_version" text,
	CONSTRAINT "plans_world_id_resident_id_day_pk" PRIMARY KEY("world_id","resident_id","day")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"world_id" uuid NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"affinity" integer NOT NULL,
	"trust" integer NOT NULL,
	"tag" text NOT NULL,
	"note" text NOT NULL,
	"feeling_kind" text,
	"feeling_intensity" integer DEFAULT 0 NOT NULL,
	"last_seen_day" integer,
	CONSTRAINT "relationships_world_id_from_id_to_id_pk" PRIMARY KEY("world_id","from_id","to_id")
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"card" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"tier" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "residents_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"world_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"seed" integer NOT NULL,
	"day" integer DEFAULT 1 NOT NULL,
	"minute" integer DEFAULT 360 NOT NULL,
	"status" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_spend_day" integer NOT NULL,
	"ai_spend_usd" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_log" ADD CONSTRAINT "ai_log_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD CONSTRAINT "dialogue_turns_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favors" ADD CONSTRAINT "favors_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_world_day_idx" ON "events" USING btree ("world_id","day");--> statement-breakpoint
CREATE INDEX "memories_world_resident_day_idx" ON "memories" USING btree ("world_id","resident_id","day");