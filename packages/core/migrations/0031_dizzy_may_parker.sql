CREATE TABLE "event_view_days" (
	"event_id" integer NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_view_days_event_id_day_pk" PRIMARY KEY("event_id","day")
);
--> statement-breakpoint
ALTER TABLE "event_view_days" ADD CONSTRAINT "event_view_days_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;