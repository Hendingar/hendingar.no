CREATE TYPE "public"."submission_method" AS ENUM('import', 'form', 'photo');--> statement-breakpoint
CREATE TYPE "public"."verification_check" AS ENUM('plausibility', 'duplicate', 'normalisation', 'categorisation', 'corroboration');--> statement-breakpoint
CREATE TYPE "public"."verification_verdict" AS ENUM('pass', 'uncertain', 'fail');--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"check" "verification_check" NOT NULL,
	"verdict" "verification_verdict" NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"reasoning" text NOT NULL,
	"model" text,
	"deterministic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "submission_method" "submission_method" DEFAULT 'import' NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verifications_event_idx" ON "verifications" USING btree ("event_id");