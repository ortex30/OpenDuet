CREATE TABLE "openduet_study_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"subject" text NOT NULL,
	"subject_key" text NOT NULL,
	"topic" text NOT NULL,
	"topic_key" text NOT NULL,
	"box" integer DEFAULT 1 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"partly_count" integer DEFAULT 0 NOT NULL,
	"missed_count" integer DEFAULT 0 NOT NULL,
	"last_result" text NOT NULL,
	"last_activity" text,
	"misconceptions" jsonb DEFAULT '{"items":[]}'::jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"last_practiced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "openduet_study_topics_box_check" CHECK ("openduet_study_topics"."box" BETWEEN 1 AND 5),
	CONSTRAINT "openduet_study_topics_result_check" CHECK ("openduet_study_topics"."last_result" IN ('correct', 'partly', 'missed'))
);
--> statement-breakpoint
ALTER TABLE "openduet_study_topics" ADD CONSTRAINT "openduet_study_topics_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openduet_study_topics" ADD CONSTRAINT "openduet_study_topics_bot_id_agents_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "openduet_study_topics_owner_topic_idx" ON "openduet_study_topics" USING btree ("owner_user_id","bot_id","subject_key","topic_key");--> statement-breakpoint
CREATE INDEX "openduet_study_topics_owner_due_idx" ON "openduet_study_topics" USING btree ("owner_user_id","due_at");