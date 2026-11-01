import { Input, UnstyledButton } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { ICON_LABEL } from '../lib/icons';
import classes from './IconPicker.module.css';

interface Props {
  label?: string;
  /** stored icon key, '' = none */
  value: string;
  onChange: (key: string) => void;
  icons: Record<string, Icon>;
  error?: string;
}

/** Grid of curated Tabler icons. Click the selected one again to clear. */
export function IconPicker({ label = 'Ikon', value, onChange, icons, error }: Props) {
  return (
    <Input.Wrapper label={label} error={error}>
      <div className={classes.grid} role="group" aria-label={label}>
        {Object.entries(icons).map(([key, Glyph]) => {
          const active = value === key;
          return (
            <UnstyledButton
              key={key}
              type="button"
              className={clsx(classes.cell, active && classes.active)}
              aria-pressed={active}
              aria-label={ICON_LABEL(key)}
              title={ICON_LABEL(key)}
              onClick={() => onChange(active ? '' : key)}
            >
              <Glyph size={22} stroke={1.75} />
            </UnstyledButton>
          );
        })}
      </div>
    </Input.Wrapper>
  );
}
