import { Text, TextInput, type TextInputProps } from '@mantine/core';
import { amountPreview } from '../lib/amount';
import classes from './AmountInput.module.css';

export type AmountInputProps = Omit<TextInputProps, 'inputMode' | 'value'> & {
  /** raw text; parse it with parseAmountText / the form schema */
  value: string;
  /** ISO code the text is in (default IDR): drives the live preview ("= US$12,50") */
  currency?: string;
};

/**
 * Text field for money in Indonesian slang ("250rb", "1,5jt", "Rp1.250.000"). Shows the parsed
 * amount live under the field. Parsing/formatting is lib/amount.ts; this only wires it up.
 * 16px font keeps iOS from zooming on focus.
 */
export function AmountInput({
  value,
  error,
  description,
  currency = 'IDR',
  ...rest
}: AmountInputProps) {
  const preview = amountPreview(value, currency);
  return (
    <div>
      <TextInput
        {...rest}
        value={value}
        error={error}
        description={description}
        inputMode="decimal"
        autoComplete="off"
        classNames={{ input: classes.input }}
      />
      {preview && !error && (
        <Text size="sm" c="dimmed" mt={4} className={classes.preview} aria-live="polite">
          = {preview}
        </Text>
      )}
    </div>
  );
}
