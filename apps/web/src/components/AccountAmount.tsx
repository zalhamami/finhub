import { Text } from '@mantine/core';
import { Amount } from './Amount';
import { foreignValue } from '../lib/money';
import classes from './AccountAmount.module.css';

interface Props {
  currency: string;
  /** ledger balance in `currency` (decimal string of minor units); null = not shown natively */
  native: string | null | undefined;
  /** value in base-currency minor units; null = no FX rate / price */
  base: string | null | undefined;
  baseCurrency: string;
  tone?: 'plain' | 'income' | 'neutral' | 'dimmed';
}

/**
 * An account's value. Base-currency accounts show the base amount. Foreign accounts show the
 * own-currency amount as the main figure and "≈ Rp…" (or "kurs belum ada") as smaller text.
 */
export function AccountAmount({ currency, native, base, baseCurrency, tone = 'plain' }: Props) {
  const fv = foreignValue(native, currency, base, baseCurrency);
  if (!fv) return <Amount minor={base} tone={tone} />;
  return (
    <span className={classes.stack}>
      <Amount minor={native} currency={currency} tone={tone} />
      <Text span size="xs" c="dimmed" className={classes.secondary}>
        {fv.secondary}
      </Text>
    </span>
  );
}
