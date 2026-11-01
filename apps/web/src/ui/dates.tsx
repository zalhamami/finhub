import { DateInput, DatePickerInput, DatesProvider, TimeInput } from '@mantine/dates';
import type { ComponentProps } from 'react';
import '../lib/dayjs';

const SETTINGS = { locale: 'id', firstDayOfWeek: 1 } as const;

/** Single date (value is a YYYY-MM-DD string). Indonesian calendar, week starts Monday. */
export function DateField(props: ComponentProps<typeof DateInput>) {
  return (
    <DatesProvider settings={SETTINGS}>
      <DateInput valueFormat="D MMM YYYY" {...props} />
    </DatesProvider>
  );
}

/** Date range (values are YYYY-MM-DD strings). */
export function DateRangeField(props: ComponentProps<typeof DatePickerInput<'range'>>) {
  return (
    <DatesProvider settings={SETTINGS}>
      <DatePickerInput valueFormat="D MMM YYYY" {...props} type="range" />
    </DatesProvider>
  );
}

export { TimeInput };
