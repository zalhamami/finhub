import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryTree } from '../src/features/CategoryTree';
import type { ApiCategory } from '../src/lib/api';
import { flattenCategories } from '../src/lib/categories';
import { ThemeRoot } from '../src/theme/AccentProvider';

const cat = (
  id: string,
  name: string,
  children: ApiCategory[] = [],
  extra: Partial<ApiCategory> = {},
): ApiCategory => ({
  id,
  parent_id: null,
  kind: 'expense',
  name,
  icon: null,
  color: 'jade',
  sort_order: 0,
  archived_at: null,
  children,
  ...extra,
});
const TREE = [
  cat('1', 'Makan & Minum', [cat('2', 'Kopi'), cat('3', 'Warung', [], { archived_at: 'x' })]),
  cat('4', 'Transportasi'),
];

function renderTree(showArchived: boolean, extra: { sorting?: boolean; onMove?: () => void } = {}) {
  const onEdit = vi.fn();
  render(
    <ThemeRoot>
      <CategoryTree
        rows={flattenCategories(TREE, 'expense', showArchived)}
        onEdit={onEdit}
        {...extra}
      />
    </ThemeRoot>,
  );
  return { onEdit };
}

describe('CategoryTree', () => {
  it('renders parents and indented children in tree order', () => {
    renderTree(false);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => [li.textContent, li.getAttribute('data-depth')])).toEqual([
      ['Makan & Minum', '0'],
      ['Kopi', '1'],
      ['Transportasi', '0'],
    ]);
  });

  it('hides archived categories unless asked, and badges them', () => {
    renderTree(false);
    expect(screen.queryByText('Warung')).toBeNull();
  });

  it('shows archived categories with an "Arsip" badge', () => {
    renderTree(true);
    expect(screen.getByText('Warung')).toBeTruthy();
    expect(screen.getByText('Arsip')).toBeTruthy();
  });

  it('clicking a row edits it', () => {
    const { onEdit } = renderTree(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ubah Kopi' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('reorder buttons appear in sort mode and are disabled at the edges of the sibling list', () => {
    const onMove = vi.fn();
    renderTree(false, { sorting: true, onMove });
    expect(
      (screen.getByRole('button', { name: 'Naikkan Makan & Minum' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Turunkan Transportasi' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Naikkan Transportasi' }));
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ category: expect.objectContaining({ id: '4' }) }),
      'up',
    );
    // Kopi is the only visible child: nowhere to move
    expect(
      (screen.getByRole('button', { name: 'Naikkan Kopi' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
