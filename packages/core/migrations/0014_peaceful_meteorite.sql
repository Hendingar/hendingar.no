ALTER TABLE "events" ADD COLUMN "appeal_text" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "appealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "appeal_verdicts" text;