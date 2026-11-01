import { ActionIcon, Badge, Group, Text, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { ApiCategory } from '../lib/api';
import type { CategoryRow } from '../lib/categories';
import { colorVar } from '../lib/palette';
import { EntityIcon } from '../ui/EntityIcon';
import classes from './CategoryTree.module.css';

interface Props {
  rows: CategoryRow[];
  sorting?: boolean;
  onEdit: (c: ApiCategory) => void;
  onMove?: (row: CategoryRow, dir: 'up' | 'down') => void;
}

/** Flat rows (from flattenCategories) with two-level indent. Pure rendering, no data access. */
export function CategoryTree({ rows, sorting, onEdit, onMove }: Props) {
  return (
    <ul className={classes.list} aria-label="Daftar kategori">
      {rows.map((row) => {
        const { category: c } = row;
        const pos = row.siblingIds.indexOf(c.id);
        return (
          <li key={c.id} className={classes.item} data-depth={row.depth}>
            <UnstyledButton
              className={clsx(classes.row, row.depth === 1 && classes.child)}
              data-archived={row.archived || undefined}
              aria-label={`Ubah ${c.name}`}
              onClick={() => onEdit(c)}
            >
              <span className={classes.icon}>
                <EntityIcon name={c.icon} fallback="category" size={18} />
              </span>
              <span
                className={classes.dot}
                style={{ '--dot': colorVar(c.color) } as React.CSSProperties}
                aria-hidden
              />
              <Text span fw={row.depth === 0 ? 600 : 500} truncate className={classes.name}>
                {c.name}
              </Text>
              {row.archived && (
                <Badge size="sm" variant="default">
                  Arsip
                </Badge>
              )}
            </UnstyledButton>
            {sorting && onMove && (
              <Group gap={2} wrap="nowrap" className={classes.moves}>
                <ActionIcon
                  size="lg"
                  aria-label={`Naikkan ${c.name}`}
                  disabled={pos <= 0}
                  onClick={() => onMove(row, 'up')}
                >
                  <IconArrowUp size={18} stroke={1.75} />
                </ActionIcon>
                <ActionIcon
                  size="lg"
                  aria-label={`Turunkan ${c.name}`}
                  disabled={pos === row.siblingIds.length - 1}
                  onClick={() => onMove(row, 'down')}
                >
                  <IconArrowDown size={18} stroke={1.75} />
                </ActionIcon>
              </Group>
            )}
          </li>
        );
      })}
    </ul>
  );
}
