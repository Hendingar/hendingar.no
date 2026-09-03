CREATE TABLE "event_hearts" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_hearts" ADD CONSTRAINT "event_hearts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_hearts_event_client_idx" ON "event_hearts" USING btree ("event_id","client_id");--> statement-breakpoint
CREATE INDEX "event_hearts_event_idx" ON "event_hearts" USING btree ("event_id");