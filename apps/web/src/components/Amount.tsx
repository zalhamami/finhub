import { clsx } from 'clsx';
import classes from './Amount.module.css';
import { formatMinorIDR } from '../lib/money';

interface Props {
  /** decimal string of minor units (bigint over JSON) */
  minor: string | null | undefined;
  tone?: 'plain' | 'income' | 'over' | 'dimmed' | 'neutral';
  hero?: boolean;
  className?: string;
}

/** Right-aligned, tabular, lining-number money. */
export function Amount({ minor, tone = 'plain', hero, className }: Props) {
  return (
    <span
      className={clsx(
        classes.amount,
        tone === 'income' && classes.income,
        tone === 'over' && classes.over,
        tone === 'dimmed' && classes.dimmed,
        tone === 'neutral' && classes.neutral,
        hero && classes.hero,
        className,
      )}
    >
      {formatMinorIDR(minor)}
    </span>
  );
}
