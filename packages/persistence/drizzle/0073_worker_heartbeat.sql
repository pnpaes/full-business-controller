CREATE TABLE "worker_heartbeat" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_heartbeat_role_check" CHECK ("worker_heartbeat"."role" in ('worker', 'scheduler'))
);
