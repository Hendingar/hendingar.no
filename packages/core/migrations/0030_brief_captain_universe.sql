CREATE TABLE "ingest_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingest_run_status" DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"revision" text,
	"sources_run" integer DEFAULT 0 NOT NULL,
	"sources_failed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "job_id" integer;--> statement-breakpoint
CREATE INDEX "ingest_jobs_started_idx" ON "ingest_jobs" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_job_id_ingest_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingest_jobs"("id") ON DELETE no action ON UPDATE no action;