ALTER TABLE "transactions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Transfer fee lines: on a transfer, an entry WITH a category_id is a fee line (an expense
-- charged to the source account). Fee lines are ignored by the transfer checks; the remaining
-- entries ("legs") need >= 2 rows and, when all in one currency, must sum to 0.
-- expense / income are unchanged (exactly one entry). Replaces the function from 0001.
CREATE OR REPLACE FUNCTION finhub_check_ledger(tx_id uuid) RETURNS void AS $$
DECLARE
  tx_kind transaction_kind;
  tx_status transaction_status;
  n integer;
  n_legs integer;
  n_currencies integer;
  total bigint;
BEGIN
  SELECT kind, status INTO tx_kind, tx_status FROM transactions WHERE id = tx_id;
  IF NOT FOUND OR tx_status <> 'posted' THEN
    RETURN; -- deleted (cascade) or draft
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE category_id IS NULL),
         count(DISTINCT currency) FILTER (WHERE category_id IS NULL),
         COALESCE(sum(amount_minor) FILTER (WHERE category_id IS NULL), 0)
    INTO n, n_legs, n_currencies, total
    FROM entries WHERE transaction_id = tx_id;

  IF tx_kind IN ('expense', 'income') AND n <> 1 THEN
    RAISE EXCEPTION 'posted % transaction % must have exactly one entry, has %', tx_kind, tx_id, n
      USING ERRCODE = 'check_violation';
  END IF;

  IF tx_kind = 'transfer' THEN
    IF n_legs < 2 THEN
      RAISE EXCEPTION 'posted transfer % must have at least two entries (excluding fee lines), has %', tx_id, n_legs
        USING ERRCODE = 'check_violation';
    END IF;
    IF n_currencies = 1 AND total <> 0 THEN
      RAISE EXCEPTION 'posted transfer % legs sum to %, expected 0', tx_id, total
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
