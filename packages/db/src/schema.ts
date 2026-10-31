import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/* Conventions: snake_case columns (explicit names), uuid PKs, money = bigint minor units
 * (mode 'bigint'), units/prices/rates = numeric mapped to string. No float columns. */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const minor = (name: string) => bigint(name, { mode: 'bigint' });
const workspaceId = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });
const wsIdx = (table: string, t: { workspaceId: AnyPgColumn }) =>
  index(`${table}_workspace_id_idx`).on(t.workspaceId);

export const accountKind = pgEnum('account_kind', [
  'cash',
  'bank',
  'ewallet',
  'investment',
  'liability',
]);
export const memberRole = pgEnum('member_role', ['owner', 'member']);
export const categoryKind = pgEnum('category_kind', ['expense', 'income']);
export const transactionKind = pgEnum('transaction_kind', [
  'expense',
  'income',
  'transfer',
  'adjustment',
]);
export const transactionStatus = pgEnum('transaction_status', ['draft', 'posted']);
export const instrumentKind = pgEnum('instrument_kind', [
  'stock',
  'mutual_fund',
  'gold',
  'crypto',
  'bond',
]);
export const holdingSource = pgEnum('holding_source', ['manual', 'connector']);

/* ---------- identity / tenancy ---------- */

export const workspaces = pgTable('workspaces', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: workspaceId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('member'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('workspace_members', t),
    uniqueIndex('workspace_members_ws_user_uq').on(t.workspaceId, t.userId),
  ],
);

export const currencies = pgTable(
  'currencies',
  {
    code: text('code').primaryKey(),
    minorUnit: integer('minor_unit').notNull(),
    displayDecimals: integer('display_decimals').notNull(),
    symbol: text('symbol').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('currencies_minor_unit_chk', sql`${t.minorUnit} >= 0`),
    check(
      'currencies_display_decimals_chk',
      sql`${t.displayDecimals} >= 0 AND ${t.displayDecimals} <= ${t.minorUnit}`,
    ),
  ],
);

export const settings = pgTable(
  'settings',
  {
    id: id(),
    workspaceId: workspaceId(),
    baseCurrency: text('base_currency')
      .notNull()
      .default('IDR')
      .references(() => currencies.code),
    locale: text('locale').notNull().default('id'),
    monthStartDay: integer('month_start_day').notNull().default(1),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('settings_workspace_id_uq').on(t.workspaceId),
    check('settings_month_start_day_chk', sql`${t.monthStartDay} BETWEEN 1 AND 28`),
  ],
);

/* ---------- accounts ---------- */

export const accountTypes = pgTable(
  'account_types',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    icon: text('icon'),
    kind: accountKind('kind').notNull(),
    hasCreditLimit: boolean('has_credit_limit').notNull().default(false),
    hasDueDay: boolean('has_due_day').notNull().default(false),
    hasHoldings: boolean('has_holdings').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('account_types', t),
    uniqueIndex('account_types_ws_name_uq').on(t.workspaceId, t.name),
  ],
);

export const accountGroups = pgTable(
  'account_groups',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('account_groups', t),
    uniqueIndex('account_groups_ws_name_uq').on(t.workspaceId, t.name),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => accountTypes.id),
    groupId: uuid('group_id').references(() => accountGroups.id, { onDelete: 'set null' }),
    currency: text('currency')
      .notNull()
      .default('IDR')
      .references(() => currencies.code),
    icon: text('icon'),
    color: text('color'),
    openingBalanceMinor: minor('opening_balance_minor')
      .notNull()
      .default(sql`0`),
    openingDate: date('opening_date', { mode: 'string' }),
    creditLimitMinor: minor('credit_limit_minor'),
    statementDay: integer('statement_day'),
    dueDay: integer('due_day'),
    includeInNetWorth: boolean('include_in_net_worth').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('accounts', t),
    index('accounts_type_id_idx').on(t.typeId),
    index('accounts_group_id_idx').on(t.groupId),
    check(
      'accounts_statement_day_chk',
      sql`${t.statementDay} IS NULL OR ${t.statementDay} BETWEEN 1 AND 31`,
    ),
    check('accounts_due_day_chk', sql`${t.dueDay} IS NULL OR ${t.dueDay} BETWEEN 1 AND 31`),
    check(
      'accounts_credit_limit_chk',
      sql`${t.creditLimitMinor} IS NULL OR ${t.creditLimitMinor} >= 0`,
    ),
  ],
);

/* ---------- categories & tags ---------- */

export const categories = pgTable(
  'categories',
  {
    id: id(),
    workspaceId: workspaceId(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'cascade',
    }),
    kind: categoryKind('kind').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [wsIdx('categories', t), index('categories_parent_id_idx').on(t.parentId)],
);

export const tags = pgTable(
  'tags',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [wsIdx('tags', t), uniqueIndex('tags_ws_name_uq').on(t.workspaceId, t.name)],
);

/* ---------- ledger ---------- */

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    workspaceId: workspaceId(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    kind: transactionKind('kind').notNull(),
    payee: text('payee'),
    note: text('note'),
    status: transactionStatus('status').notNull().default('posted'),
    source: text('source').notNull().default('manual'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('transactions', t),
    index('transactions_ws_occurred_idx').on(t.workspaceId, t.occurredAt),
  ],
);

export const entries = pgTable(
  'entries',
  {
    id: id(),
    workspaceId: workspaceId(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    amountMinor: minor('amount_minor').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('entries', t),
    index('entries_transaction_id_idx').on(t.transactionId),
    index('entries_account_id_idx').on(t.accountId),
    index('entries_category_id_idx').on(t.categoryId),
  ],
);

export const transactionTags = pgTable(
  'transaction_tags',
  {
    id: id(),
    workspaceId: workspaceId(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('transaction_tags', t),
    uniqueIndex('transaction_tags_tx_tag_uq').on(t.transactionId, t.tagId),
    index('transaction_tags_tag_id_idx').on(t.tagId),
  ],
);

export const externalRefs = pgTable(
  'external_refs',
  {
    id: id(),
    workspaceId: workspaceId(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('external_refs', t),
    uniqueIndex('external_refs_ws_source_ext_uq').on(t.workspaceId, t.source, t.externalId),
    index('external_refs_transaction_id_idx').on(t.transactionId),
  ],
);

/* ---------- FX, instruments, holdings, prices ---------- */

export const fxRates = pgTable(
  'fx_rates',
  {
    id: id(),
    workspaceId: workspaceId(),
    base: text('base')
      .notNull()
      .references(() => currencies.code),
    quote: text('quote')
      .notNull()
      .references(() => currencies.code),
    date: date('date', { mode: 'string' }).notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    source: text('source').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('fx_rates', t),
    uniqueIndex('fx_rates_uq').on(t.workspaceId, t.base, t.quote, t.date, t.source),
    check('fx_rates_rate_chk', sql`${t.rate} > 0`),
  ],
);

export const instruments = pgTable(
  'instruments',
  {
    id: id(),
    workspaceId: workspaceId(),
    kind: instrumentKind('kind').notNull(),
    symbol: text('symbol').notNull(),
    exchange: text('exchange'),
    name: text('name').notNull(),
    currency: text('currency')
      .notNull()
      .default('IDR')
      .references(() => currencies.code),
    unitLabel: text('unit_label'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [wsIdx('instruments', t)],
);

export const holdings = pgTable(
  'holdings',
  {
    id: id(),
    workspaceId: workspaceId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    units: numeric('units', { precision: 30, scale: 10 }).notNull(),
    costBasisMinor: minor('cost_basis_minor'),
    source: holdingSource('source').notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('holdings', t),
    uniqueIndex('holdings_account_instrument_uq').on(t.accountId, t.instrumentId),
    index('holdings_instrument_id_idx').on(t.instrumentId),
  ],
);

export const prices = pgTable(
  'prices',
  {
    id: id(),
    workspaceId: workspaceId(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    price: numeric('price', { precision: 30, scale: 10 }).notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    source: text('source').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('prices', t),
    uniqueIndex('prices_instrument_date_source_uq').on(t.instrumentId, t.date, t.source),
    check('prices_price_chk', sql`${t.price} >= 0`),
  ],
);

/* ---------- snapshots ---------- */

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: id(),
    workspaceId: workspaceId(),
    date: date('date', { mode: 'string' }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    balanceMinor: minor('balance_minor').notNull(),
    valueBaseMinor: minor('value_base_minor').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('balance_snapshots', t),
    uniqueIndex('balance_snapshots_account_date_uq').on(t.accountId, t.date),
  ],
);

export const netWorthSnapshots = pgTable(
  'net_worth_snapshots',
  {
    id: id(),
    workspaceId: workspaceId(),
    date: date('date', { mode: 'string' }).notNull(),
    assetsBaseMinor: minor('assets_base_minor').notNull(),
    liabilitiesBaseMinor: minor('liabilities_base_minor').notNull(),
    netWorthBaseMinor: minor('net_worth_base_minor').notNull(),
    byKind: jsonb('by_kind')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    wsIdx('net_worth_snapshots', t),
    uniqueIndex('net_worth_snapshots_ws_date_uq').on(t.workspaceId, t.date),
  ],
);
