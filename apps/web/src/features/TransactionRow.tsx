import { Text, UnstyledButton } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Amount } from '../components/Amount';
import type { ApiAccount, ApiTransaction } from '../lib/api';
import type { indexCategories } from '../lib/categories';
import { formatMinorCurrency } from '../lib/money';
import { jakartaTime } from '../lib/dates';
import { colorVar } from '../lib/palette';
import { describeTransaction, type FxContext } from '../lib/transactions';
import { EntityIcon } from '../ui/EntityIcon';
import classes from './TransactionRow.module.css';

/** One transaction as a list row (a <li>); shared by Transaksi and Beranda. */
export function TransactionRow({
  tx,
  accounts,
  categories,
  fx,
  onOpen,
  viewAccountId,
  showTime,
}: {
  fx?: FxContext;
  /** list of one account: transfers show this account's leg, signed */
  viewAccountId?: string;
  /** Jakarta HH:mm under the amount */
  showTime?: boolean;
  tx: ApiTransaction;
  accounts: ReadonlyMap<string, ApiAccount>;
  categories: ReturnType<typeof indexCategories>;
  onOpen: (tx: ApiTransaction) => void;
}) {
  const m = describeTransaction(tx, accounts, categories, fx, viewAccountId);
  const editable = tx.kind !== 'adjustment';
  const body = (
    <>
      <span
        className={classes.icon}
        style={{ '--cat': colorVar(m.category?.color, 7) } as React.CSSProperties}
        aria-hidden
      >
        <EntityIcon
          name={m.category?.icon}
          fallback={tx.kind === 'transfer' ? 'cash' : 'receipt'}
        />
      </span>
      <span className={classes.main}>
        <Text span fw={500} truncate className={classes.title}>
          {m.title}
        </Text>
        {m.route && (
          <span className={classes.route}>
            <Text span size="sm" c="dimmed" truncate className={classes.routeName}>
              {m.route.from}
            </Text>
            <IconArrowRight size={14} stroke={1.75} className={classes.routeArrow} aria-hidden />
            <Text span size="sm" c="dimmed" truncate className={classes.routeName}>
              {m.route.to}
            </Text>
          </span>
        )}
        {m.detail && (
          <Text span size="sm" c="dimmed" truncate>
            {m.detail}
          </Text>
        )}
        {m.accountName && (
          <Text span size="sm" c="dimmed" truncate className={classes.accountMobile}>
            {m.accountName}
          </Text>
        )}
      </span>
      <Text span size="sm" c="dimmed" truncate className={classes.account}>
        {m.accountName}
      </Text>
      <span className={classes.amountCell}>
        <Amount
          minor={m.amount.minor}
          currency={m.amount.currency}
          tone={m.amount.tone}
          className={classes.amountText}
        />
        {m.secondary && (
          <Text span size="xs" c="dimmed" className={classes.fee}>
            {m.secondary}
          </Text>
        )}
        {showTime && (
          <Text span size="xs" c="dimmed" className={classes.fee}>
            {jakartaTime(tx.occurred_at)}
          </Text>
        )}
        {m.feeMinor && (
          <Text span size="xs" c="dimmed" className={classes.fee}>
            biaya {formatMinorCurrency(m.feeMinor, m.amount.currency)}
          </Text>
        )}
      </span>
    </>
  );
  return (
    <li className={classes.item}>
      {editable ? (
        <UnstyledButton className={classes.row} onClick={() => onOpen(tx)}>
          {body}
        </UnstyledButton>
      ) : (
        <div className={classes.row}>{body}</div>
      )}
    </li>
  );
}
