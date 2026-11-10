CREATE TABLE "openduet_study_records" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"bot_id" text,
	"kind" text NOT NULL,
	"class_id" text,
	"ref_id" text,
	"status" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "openduet_study_records" ADD CONSTRAINT "openduet_study_records_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "openduet_study_records_owner_kind_created_idx" ON "openduet_study_records" USING btree ("owner_user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "openduet_study_records_owner_kind_starts_idx" ON "openduet_study_records" USING btree ("owner_user_id","kind","starts_at");