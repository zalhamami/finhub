import { Input, UnstyledButton } from '@mantine/core';
import { clsx } from 'clsx';
import { COLOR_LABEL, COLOR_NAMES, colorVar } from '../lib/palette';
import classes from './ColorNamePicker.module.css';

interface Props {
  label?: string;
  /** stored Mantine color NAME ('amber', 'jade', ...), '' = none */
  value: string;
  onChange: (name: string) => void;
  error?: string;
}

/** Swatches of the theme palette. Stores the color name, never a hex. Click the selected one to clear. */
export function ColorNamePicker({ label = 'Warna', value, onChange, error }: Props) {
  return (
    <Input.Wrapper label={label} error={error}>
      <div className={classes.row} role="group" aria-label={label}>
        {COLOR_NAMES.map((name) => {
          const active = value === name;
          return (
            <UnstyledButton
              key={name}
              type="button"
              className={clsx(classes.swatch, active && classes.active)}
              aria-pressed={active}
              aria-label={COLOR_LABEL[name]}
              title={COLOR_LABEL[name]}
              onClick={() => onChange(active ? '' : name)}
            >
              <span
                className={classes.chip}
                style={{ '--chip': colorVar(name) } as React.CSSProperties}
              />
            </UnstyledButton>
          );
        })}
      </div>
    </Input.Wrapper>
  );
}
