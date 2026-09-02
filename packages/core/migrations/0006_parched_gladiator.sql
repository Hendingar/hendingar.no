CREATE TYPE "public"."recurrence_freq" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "event_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"freq" "recurrence_freq" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"weekdays" integer[] DEFAULT '{}' NOT NULL,
	"nth" integer,
	"anchor_date" date NOT NULL,
	"until" date,
	"start_time" text NOT NULL,
	"end_time" text,
	"timezone" text DEFAULT 'Europe/Oslo' NOT NULL,
	"materialised_through" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "series_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_series_starts_at_idx" ON "events" USING btree ("series_id","starts_at");