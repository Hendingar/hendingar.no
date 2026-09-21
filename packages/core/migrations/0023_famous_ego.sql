ALTER TABLE "verifications" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "tokens" integer;--> statement-breakpoint
CREATE INDEX "verifications_check_created_idx" ON "verifications" USING btree ("check","created_at");