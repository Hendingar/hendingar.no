ALTER TYPE "public"."submission_outcome" ADD VALUE 'contributed';--> statement-breakpoint
CREATE TABLE "event_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"client_id" text,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"applied" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_contributions" ADD CONSTRAINT "event_contributions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_contributions" ADD CONSTRAINT "event_contributions_submission_id_events_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_contributions_event_idx" ON "event_contributions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_contributions_submission_idx" ON "event_contributions" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_contributions_submission_field_idx" ON "event_contributions" USING btree ("submission_id","field");