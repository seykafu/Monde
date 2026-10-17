CREATE TABLE "survey_answers" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"telemetry_id" uuid NOT NULL,
	"world_id" uuid,
	"survey" text NOT NULL,
	"question" text NOT NULL,
	"resident" text,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"telemetry_id" uuid NOT NULL,
	"world_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"day" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_event_id_telemetry_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."telemetry_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telemetry_world_idx" ON "telemetry_events" USING btree ("world_id");--> statement-breakpoint
CREATE INDEX "telemetry_install_idx" ON "telemetry_events" USING btree ("telemetry_id");