import type { ApiCategory, CategoryKind } from './api';

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  expense: 'Pengeluaran',
  income: 'Pemasukan',
};

export interface CategoryRow {
  category: ApiCategory;
  /** 0 = top level; anything deeper is shown at depth 1 (two levels in the UI) */
  depth: 0 | 1;
  archived: boolean;
  /** siblings (same parent, as listed) this row can be reordered among */
  siblingIds: string[];
}

/** Nested API tree -> flat display rows in tree order. Archived nodes are hidden unless asked for. */
export function flattenCategories(
  roots: ApiCategory[],
  kind: CategoryKind,
  showArchived: boolean,
): CategoryRow[] {
  const out: CategoryRow[] = [];
  const visit = (nodes: ApiCategory[], depth: number) => {
    const visible = nodes.filter((n) => showArchived || !n.archived_at);
    const siblingIds = visible.map((n) => n.id);
    for (const category of visible) {
      out.push({
        category,
        depth: depth === 0 ? 0 : 1,
        archived: category.archived_at !== null,
        siblingIds,
      });
      visit(category.children, depth + 1);
    }
  };
  visit(
    roots.filter((r) => r.kind === kind),
    0,
  );
  return out;
}

/** Valid parents when creating/editing: active top-level categories of the same kind, minus self. */
export function parentOptions(
  roots: ApiCategory[],
  kind: CategoryKind,
  selfId?: string,
): ApiCategory[] {
  return roots.filter((r) => r.kind === kind && !r.archived_at && r.id !== selfId);
}

export interface SelectGroup {
  group: string;
  items: { value: string; label: string }[];
}

/**
 * Category picker data: one group per top-level category (the parent itself first, then its
 * children). Archived categories are hidden except `keep` (the one an edited entry already has).
 * With no `kind`, both kinds are listed and group labels carry the kind.
 */
export function categorySelectData(
  roots: ApiCategory[],
  kind: CategoryKind | null,
  opts: { keep?: string } = {},
): SelectGroup[] {
  const visible = (c: ApiCategory) => !c.archived_at || c.id === opts.keep;
  const out: SelectGroup[] = [];
  for (const root of roots) {
    if (kind && root.kind !== kind) continue;
    const items = [root, ...root.children]
      .filter(visible)
      .map((c) => ({ value: c.id, label: c.name }));
    if (items.length === 0) continue;
    out.push({
      group: kind ? root.name : `${CATEGORY_KIND_LABEL[root.kind]} · ${root.name}`,
      items,
    });
  }
  return out;
}

/** Default fee category for a transfer: an active expense category named "Biaya Admin", else "Biaya…". Empty if none. */
export function defaultFeeCategory(roots: ApiCategory[]): string {
  const all = roots
    .flatMap((r) => [r, ...r.children])
    .filter((c) => c.kind === 'expense' && !c.archived_at);
  const lower = (c: ApiCategory) => c.name.trim().toLowerCase();
  return (
    all.find((c) => lower(c).startsWith('biaya admin'))?.id ??
    all.find((c) => lower(c).startsWith('biaya'))?.id ??
    ''
  );
}

export interface CategoryInfo {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
}

/** id -> display info for every category in the tree (any depth, archived included). */
export function indexCategories(roots: ApiCategory[]): Map<string, CategoryInfo> {
  const out = new Map<string, CategoryInfo>();
  const visit = (nodes: ApiCategory[]) => {
    for (const c of nodes) {
      out.set(c.id, { id: c.id, name: c.name, kind: c.kind, icon: c.icon, color: c.color });
      visit(c.children);
    }
  };
  visit(roots);
  return out;
}
