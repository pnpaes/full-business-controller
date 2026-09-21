-- Custom SQL migration file, put your code below! --
-- `DEC-083` contract step: `import_disposition` (`0033`) is now the source of
-- truth and no reader/writer touches `import_run.diagnostics.dispositions`
-- (`IMPORT_DIAGNOSTIC_KEYS` never carried it; the dead reader was removed with
-- the application wiring). Drop the retained-frozen key from every run that
-- still carries it. Other `diagnostics` keys (posting_policy/issues/conflicts/
-- totals) are untouched. The column is `jsonb NOT NULL DEFAULT '{}'`, so the
-- `?` guard is the only safety needed.
UPDATE "import_run"
SET "diagnostics" = "diagnostics" - 'dispositions'
WHERE "diagnostics" ? 'dispositions';
