ALTER TABLE "import_staging_row" DROP CONSTRAINT "import_staging_row_mapping_state_check";--> statement-breakpoint
ALTER TABLE "sales_line" DROP CONSTRAINT "sales_line_mapping_state_check";--> statement-breakpoint
ALTER TABLE "import_staging_row" ADD CONSTRAINT "import_staging_row_mapping_state_check" CHECK ("import_staging_row"."mapping_state" in ('unmapped', 'mapped', 'ignored', 'error', 'conflict'));--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_mapping_state_check" CHECK ("sales_line"."mapping_state" in ('unmapped', 'mapped', 'ignored', 'error', 'conflict'));