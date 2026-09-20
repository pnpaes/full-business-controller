ALTER TABLE "price_scenario" ADD COLUMN "target_contribution_pct" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "price_scenario" ADD COLUMN "volume_assumption" numeric(19, 6);--> statement-breakpoint
ALTER TABLE "price_scenario" ADD COLUMN "fee_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "price_scenario" ADD COLUMN "outcome" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_component" ADD CONSTRAINT "snapshot_component_kind_check" CHECK ("snapshot_component"."component_kind" in ('ingredient', 'packaging', 'direct_labor', 'channel_variable', 'other_variable', 'allocated_overhead'));