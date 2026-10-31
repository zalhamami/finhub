-- Ledger integrity, enforced at COMMIT (constraint triggers are DEFERRABLE INITIALLY DEFERRED),
-- so a transaction header and its entries may be inserted in any order within one DB transaction.
-- Only POSTED transactions are checked; drafts are ignored.
--   expense / income : exactly one entry
--   transfer         : at least two entries; if all entries share one currency they must sum to 0
--                      (cross-currency transfers keep both amounts and are not summed)
CREATE FUNCTION finhub_check_ledger(tx_id uuid) RETURNS void AS $$
DECLARE
  tx_kind transaction_kind;
  tx_status transaction_status;
  n integer;
  n_currencies integer;
  total bigint;
BEGIN
  SELECT kind, status INTO tx_kind, tx_status FROM transactions WHERE id = tx_id;
  IF NOT FOUND OR tx_status <> 'posted' THEN
    RETURN; -- deleted (cascade) or draft
  END IF;

  SELECT count(*), count(DISTINCT currency), COALESCE(sum(amount_minor), 0)
    INTO n, n_currencies, total
    FROM entries WHERE transaction_id = tx_id;

  IF tx_kind IN ('expense', 'income') AND n <> 1 THEN
    RAISE EXCEPTION 'posted % transaction % must have exactly one entry, has %', tx_kind, tx_id, n
      USING ERRCODE = 'check_violation';
  END IF;

  IF tx_kind = 'transfer' THEN
    IF n < 2 THEN
      RAISE EXCEPTION 'posted transfer % must have at least two entries, has %', tx_id, n
        USING ERRCODE = 'check_violation';
    END IF;
    IF n_currencies = 1 AND total <> 0 THEN
      RAISE EXCEPTION 'posted transfer % entries sum to %, expected 0', tx_id, total
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION finhub_entries_ledger_trigger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM finhub_check_ledger(OLD.transaction_id);
  ELSE
    PERFORM finhub_check_ledger(NEW.transaction_id);
    IF TG_OP = 'UPDATE' AND OLD.transaction_id <> NEW.transaction_id THEN
      PERFORM finhub_check_ledger(OLD.transaction_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION finhub_transactions_ledger_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM finhub_check_ledger(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entries_ledger_check
  AFTER INSERT OR UPDATE OR DELETE ON entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finhub_entries_ledger_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_ledger_check
  AFTER INSERT OR UPDATE OF kind, status ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finhub_transactions_ledger_trigger();
