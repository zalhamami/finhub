import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb, type Db } from './client';
import * as s from './schema';

const DEMO_SLUG = 'demo';

const TYPES: Omit<typeof s.accountTypes.$inferInsert, 'workspaceId'>[] = [
  { name: 'Cash', kind: 'cash' },
  { name: 'Bank', kind: 'bank' },
  { name: 'E-wallet', kind: 'ewallet' },
  { name: 'Saham', kind: 'investment', hasHoldings: true },
  { name: 'Reksa dana', kind: 'investment', hasHoldings: true },
  { name: 'Emas', kind: 'investment', hasHoldings: true },
  { name: 'Crypto', kind: 'investment', hasHoldings: true },
  { name: 'Credit card', kind: 'liability', hasCreditLimit: true, hasDueDay: true },
  { name: 'Paylater', kind: 'liability', hasCreditLimit: true, hasDueDay: true },
  { name: 'Loan', kind: 'liability' },
];

const EXPENSE_TREE: { name: string; children?: string[] }[] = [
  { name: 'Makan & Minum', children: ['Kopi'] },
  { name: 'Transportasi' },
  { name: 'Belanja' },
  { name: 'Tagihan' },
  { name: 'Biaya admin' },
];
const INCOME = ['Gaji', 'Bonus/THR'];

/** Idempotent: safe to run repeatedly. No real accounts or balances. */
export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(s.currencies)
      .values([
        { code: 'IDR', minorUnit: 2, displayDecimals: 0, symbol: 'Rp' },
        { code: 'USD', minorUnit: 2, displayDecimals: 2, symbol: '$' },
        { code: 'SGD', minorUnit: 2, displayDecimals: 2, symbol: 'S$' },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.workspaces)
      .values({ slug: DEMO_SLUG, name: 'Demo' })
      .onConflictDoNothing({ target: s.workspaces.slug });
    const [ws] = await tx.select().from(s.workspaces).where(eq(s.workspaces.slug, DEMO_SLUG));
    if (!ws) throw new Error('demo workspace missing');
    const workspaceId = ws.id;

    const [hasSettings] = await tx
      .select({ id: s.settings.id })
      .from(s.settings)
      .where(eq(s.settings.workspaceId, workspaceId));
    if (!hasSettings) await tx.insert(s.settings).values({ workspaceId });

    await tx
      .insert(s.accountTypes)
      .values(TYPES.map((t) => ({ ...t, workspaceId })))
      .onConflictDoNothing();

    const existing = await tx
      .select({ name: s.categories.name, parentId: s.categories.parentId })
      .from(s.categories)
      .where(eq(s.categories.workspaceId, workspaceId));
    const topNames = new Set(existing.filter((c) => !c.parentId).map((c) => c.name));

    const ensureTop = async (name: string, kind: 'expense' | 'income', sortOrder: number) => {
      if (!topNames.has(name)) {
        await tx.insert(s.categories).values({ workspaceId, name, kind, sortOrder });
      }
      const [row] = await tx
        .select({ id: s.categories.id })
        .from(s.categories)
        .where(
          and(
            eq(s.categories.workspaceId, workspaceId),
            eq(s.categories.name, name),
            isNull(s.categories.parentId),
          ),
        );
      return row!.id;
    };

    let order = 0;
    for (const top of EXPENSE_TREE) {
      const parentId = await ensureTop(top.name, 'expense', order++);
      for (const child of top.children ?? []) {
        const [has] = await tx
          .select({ id: s.categories.id })
          .from(s.categories)
          .where(and(eq(s.categories.parentId, parentId), eq(s.categories.name, child)));
        if (!has) {
          await tx
            .insert(s.categories)
            .values({ workspaceId, parentId, name: child, kind: 'expense' });
        }
      }
    }
    for (const name of INCOME) await ensureTop(name, 'income', order++);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const h = createDb(url, { max: 1 });
  try {
    await seed(h.db);
    console.log('seed complete');
  } finally {
    await h.close();
  }
}
