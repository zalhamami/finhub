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
