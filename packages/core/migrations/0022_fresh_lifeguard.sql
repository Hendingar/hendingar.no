CREATE TABLE "curator_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"for_date" date NOT NULL,
	"event_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"reason" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curator_picks" ADD CONSTRAINT "curator_picks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curator_picks_date_event_idx" ON "curator_picks" USING btree ("for_date","event_id");--> statement-breakpoint
CREATE INDEX "curator_picks_date_idx" ON "curator_picks" USING btree ("for_date");