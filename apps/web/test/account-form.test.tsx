import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountForm, type AccountFormProps } from '../src/features/AccountForm';
import type { ApiAccountType } from '../src/lib/api';
import { ThemeRoot } from '../src/theme/AccentProvider';

const type = (
  id: string,
  name: string,
  kind: ApiAccountType['kind'],
  extra = {},
): ApiAccountType => ({
  id,
  name,
  icon: null,
  kind,
  has_credit_limit: false,
  has_due_day: false,
  has_holdings: false,
  ...extra,
});
const TYPES = [
  type('00000000-0000-4000-8000-000000000001', 'Bank', 'bank'),
  type('00000000-0000-4000-8000-000000000002', 'Credit card', 'liability', {
    has_credit_limit: true,
    has_due_day: true,
  }),
];
const CURRENCIES = [
  { code: 'IDR', minor_unit: 2, display_decimals: 0, symbol: 'Rp' },
  { code: 'USD', minor_unit: 2, display_decimals: 2, symbol: '$' },
];

function setup(props: Partial<AccountFormProps> = {}) {
  const onSubmit = vi.fn();
  render(
    <ThemeRoot>
      <AccountForm
        types={TYPES}
        groups={[]}
        currencies={CURRENCIES}
        onSubmit={onSubmit}
        onCreateGroup={vi.fn()}
        {...props}
      />
    </ThemeRoot>,
  );
  return { onSubmit };
}

async function chooseType(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: /Jenis akun/ }));
  fireEvent.click(await screen.findByRole('option', { name, hidden: true }));
}

describe('AccountForm', () => {
  it('shows validation errors and does not submit an empty form', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nama wajib diisi')).toBeTruthy();
    expect(screen.getByText('Pilih jenis akun')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects an unparseable opening balance', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText(/Nama akun/), { target: { value: 'BCA' } });
    await chooseType('Bank');
    fireEvent.change(screen.getByLabelText('Saldo awal'), { target: { value: 'banyak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText(/Nominal tidak dikenali/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a live preview and submits slang amounts as minor units', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText(/Nama akun/), { target: { value: '  BCA Tahapan ' } });
    await chooseType('Bank');
    fireEvent.change(screen.getByLabelText('Saldo awal'), { target: { value: '1,5jt' } });
    expect(screen.getByText('= Rp1.500.000')).toBeTruthy();
    expect(screen.getByLabelText('Saldo awal').getAttribute('inputmode')).toBe('decimal');

    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      name: 'BCA Tahapan',
      type_id: TYPES[0]!.id,
      group_id: null,
      currency: 'IDR',
      icon: null,
      color: null,
      opening_balance_minor: '150000000',
      opening_date: null,
      credit_limit_minor: null,
      statement_day: null,
      due_day: null,
      include_in_net_worth: true,
    });
  });

  it('credit limit and due day fields appear only for types that have them', async () => {
    setup();
    expect(screen.queryByLabelText('Limit kredit')).toBeNull();
    expect(screen.queryByLabelText('Tanggal jatuh tempo')).toBeNull();

    await chooseType('Credit card');
    expect(screen.getByLabelText('Limit kredit')).toBeTruthy();
    expect(screen.getByLabelText('Tanggal tagihan')).toBeTruthy();
    expect(screen.getByLabelText('Tanggal jatuh tempo')).toBeTruthy();

    await chooseType('Bank');
    await waitFor(() => expect(screen.queryByLabelText('Limit kredit')).toBeNull());
    expect(screen.queryByLabelText('Tanggal jatuh tempo')).toBeNull();
  });

  it('submits credit fields for a credit card and validates the day range', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText(/Nama akun/), { target: { value: 'Kartu' } });
    await chooseType('Credit card');
    fireEvent.change(screen.getByLabelText('Limit kredit'), { target: { value: '20jt' } });
    fireEvent.change(screen.getByLabelText('Tanggal tagihan'), { target: { value: '32' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Isi tanggal 1–31')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Tanggal tagihan'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Tanggal jatuh tempo'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      credit_limit_minor: '2000000000',
      statement_day: 5,
      due_day: 25,
    });
  });

  it('stores the icon key and the color NAME, not a hex', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText(/Nama akun/), { target: { value: 'Dompet' } });
    await chooseType('Bank');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Ikon' })).getByRole('button', { name: 'wallet' }),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Warna' })).getByRole('button', { name: 'Jade' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ icon: 'wallet', color: 'jade' });
  });

  it('edit mode prefills from the account and offers archive and delete', () => {
    const onToggleArchive = vi.fn();
    const onDelete = vi.fn();
    setup({
      account: {
        id: 'x',
        name: 'Tabungan',
        type_id: TYPES[0]!.id,
        group_id: null,
        currency: 'IDR',
        icon: null,
        color: null,
        opening_balance_minor: '125000000',
        opening_date: '2026-01-15',
        credit_limit_minor: null,
        statement_day: null,
        due_day: null,
        include_in_net_worth: true,
        sort_order: 0,
        archived_at: null,
      },
      onToggleArchive,
      onDelete,
    });
    expect((screen.getByLabelText(/Nama akun/) as HTMLInputElement).value).toBe('Tabungan');
    expect((screen.getByLabelText('Saldo awal') as HTMLInputElement).value).toBe('1250000');
    fireEvent.click(screen.getByRole('button', { name: 'Arsipkan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    expect(onToggleArchive).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it('shows an API failure message', () => {
    setup({ error: 'Akun ini sudah punya transaksi' });
    expect(screen.getByRole('alert').textContent).toContain('sudah punya transaksi');
  });
});
