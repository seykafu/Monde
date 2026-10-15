CREATE TABLE "conversation_digests" (
	"world_id" uuid NOT NULL,
	"resident_id" text NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "conversation_digests_world_id_resident_id_pk" PRIMARY KEY("world_id","resident_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_sessions" (
	"world_id" uuid NOT NULL,
	"id" text NOT NULL,
	"resident_id" text NOT NULL,
	"opened_day" integer NOT NULL,
	"opened_minute" integer NOT NULL,
	"last_day" integer NOT NULL,
	"last_minute" integer NOT NULL,
	"closed_day" integer,
	"closed_minute" integer,
	"exchanges" integer DEFAULT 0 NOT NULL,
	"exchange_limit" integer DEFAULT 6 NOT NULL,
	"place" text NOT NULL,
	"resume_until" integer DEFAULT 0 NOT NULL,
	"compacted" boolean DEFAULT false NOT NULL,
	"history" text NOT NULL,
	"system" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_sessions_world_id_id_pk" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"world_id" uuid NOT NULL,
	"conversation_id" text NOT NULL,
	"resident_id" text NOT NULL,
	"day" integer NOT NULL,
	"minute" integer NOT NULL,
	"summary" text NOT NULL,
	"facts" jsonb NOT NULL,
	"topics" text[] NOT NULL,
	"felt_after" text NOT NULL,
	"digested" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_summaries_world_id_conversation_id_pk" PRIMARY KEY("world_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD COLUMN "raw_output" text;--> statement-breakpoint
ALTER TABLE "dialogue_turns" ADD COLUMN "prompt_user" text;--> statement-breakpoint
ALTER TABLE "conversation_digests" ADD CONSTRAINT "conversation_digests_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_latest_idx" ON "conversation_sessions" USING btree ("world_id","resident_id","created_at");