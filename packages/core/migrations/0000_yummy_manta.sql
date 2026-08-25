CREATE TYPE "public"."category" AS ENUM('musikk', 'teater', 'utstilling', 'sport', 'mote', 'kyrkjeliv', 'festival', 'litteratur', 'stand-up', 'show', 'mat-og-drikke', 'dans', 'marknad', 'konferanse', 'kurs', 'anna');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('pending', 'published', 'flagged', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."geocode_status" AS ENUM('pending', 'resolved', 'ambiguous', 'failed');--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"external_id" text,
	"source_url" text,
	"title" text NOT NULL,
	"description" text,
	"category" "category" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue_id" integer,
	"organizer_id" integer,
	"cta_url" text,
	"poster_url" text,
	"poster_rights_verified" boolean DEFAULT false NOT NULL,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"verification_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	CONSTRAINT "organizers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"region" text NOT NULL,
	"attribution" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"municipality" text,
	"latitude" double precision,
	"longitude" double precision,
	"geocode_status" "geocode_status" DEFAULT 'pending' NOT NULL,
	"geocoded_at" timestamp with time zone,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_idx" ON "events" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "events_status_starts_at_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "venues_lat_lon_idx" ON "venues" USING btree ("latitude","longitude");