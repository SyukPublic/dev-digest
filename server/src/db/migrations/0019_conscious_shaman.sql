CREATE TABLE "pr_why_risk_brief" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"json" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"freshness_key" text
);
--> statement-breakpoint
ALTER TABLE "pr_why_risk_brief" ADD CONSTRAINT "pr_why_risk_brief_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_why_risk_brief" ADD CONSTRAINT "pr_why_risk_brief_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;