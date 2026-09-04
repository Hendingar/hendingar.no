CREATE TYPE "public"."submission_outcome" AS ENUM('approved', 'duplicate', 'shady', 'declined');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "submission_outcome" "submission_outcome";