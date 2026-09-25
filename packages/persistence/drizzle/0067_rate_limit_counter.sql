CREATE TABLE "rate_limit_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"hits" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_counter_namespace_key_key" UNIQUE("namespace","key")
);
