CREATE TABLE "eval_skill_stability_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version" integer NOT NULL,
	"host_agent_id" uuid NOT NULL,
	"host_agent_version" integer NOT NULL,
	"n_requested" integer NOT NULL,
	"status" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_skill_suite_runs" ADD COLUMN "stability_group_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_skill_stability_groups" ADD CONSTRAINT "eval_skill_stability_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_skill_suite_runs" ADD CONSTRAINT "eval_skill_suite_runs_stability_group_id_eval_skill_stability_groups_id_fk" FOREIGN KEY ("stability_group_id") REFERENCES "public"."eval_skill_stability_groups"("id") ON DELETE cascade ON UPDATE no action;