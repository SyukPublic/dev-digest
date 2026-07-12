CREATE TABLE "eval_skill_suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version" integer NOT NULL,
	"host_agent_id" uuid NOT NULL,
	"host_agent_version" integer NOT NULL,
	"status" text NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"passed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skill_suite_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_skill_suite_runs" ADD CONSTRAINT "eval_skill_suite_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_skill_suite_run_id_eval_skill_suite_runs_id_fk" FOREIGN KEY ("skill_suite_run_id") REFERENCES "public"."eval_skill_suite_runs"("id") ON DELETE cascade ON UPDATE no action;