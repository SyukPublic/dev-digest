ALTER TABLE "agent_runs" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "github_url" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "ci_installation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_ci_installation_id_ci_installations_id_fk" FOREIGN KEY ("ci_installation_id") REFERENCES "public"."ci_installations"("id") ON DELETE set null ON UPDATE no action;