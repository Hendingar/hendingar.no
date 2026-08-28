CREATE TYPE "public"."ingest_run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('json-api', 'feed', 'html', 'manual');--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingest_run_status" DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"message" text,
	"revision" text
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "kind" "source_kind" DEFAULT 'json-api' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "endpoint" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "schedule_cron" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "trusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_runs_source_started_idx" ON "ingest_runs" USING btree ("source_id","started_at");