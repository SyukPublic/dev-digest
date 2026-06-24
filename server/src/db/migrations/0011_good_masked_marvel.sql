ALTER TABLE "conventions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "source" text DEFAULT 'llm' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "occurrences" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "extracted_at" timestamp with time zone;