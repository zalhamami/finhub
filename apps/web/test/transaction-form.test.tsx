import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionForm, type TransactionFormProps } from '../src/features/TransactionForm';
import type { ApiAccount, ApiCategory } from '../src/lib/api';
import { emptyTxForm } from '../src/lib/transactions';
import { ThemeRoot } from '../src/theme/AccentProvider';

const A_BCA = '00000000-0000-4000-8000-0000000000a1';
const A_CASH = '00000000-0000-4000-8000-0000000000a2';
const A_USD = '00000000-0000-4000-8000-0000000000a3';
const C_FOOD = '00000000-0000-4000-8000-0000000000c1';
const C_SALARY = '00000000-0000-4000-8000-0000000000c2';
const C_FEE = '00000000-0000-4000-8000-0000000000c3';

const acc = (id: string, name: string, currency = 'IDR'): ApiAccount => ({
  id,
  name,
  type_id: 't1',
  group_id: null,
  currency,
  icon: null,
  color: 'jade',
  opening_balance_minor: '0',
  opening_date: null,
  credit_limit_minor: null,
  statement_day: null,
  due_day: null,
  include_in_net_worth: true,
  sort_order: 0,
  archived_at: null,
});
const cat = (id: string, name: string, kind: 'expense' | 'income'): ApiCategory => ({
  id,
  parent_id: null,
  kind,
  name,
  icon: null,
  color: null,
  sort_order: 0,
  archived_at: null,
  children: [],
});

function setup(props: Partial<TransactionFormProps> = {}) {
  const onSubmit = vi.fn(async () => true);
  render(
    <ThemeRoot>
      <TransactionForm
        mode="create"
        initial={{ ...emptyTxForm('2026-10-31'), time: '09:00', fee_category_id: C_FEE }}
        accounts={[acc(A_BCA, 'BCA'), acc(A_CASH, 'Dompet'), acc(A_USD, 'Wise', 'USD')]}
        accountTypes={[]}
        categories={[
          cat(C_FOOD, 'Makan', 'expense'),
          cat(C_SALARY, 'Gaji', 'income'),
          cat(C_FEE, 'Biaya Admin', 'expense'),
        ]}
        balances={new Map([[A_BCA, '250000000']])}
        onSubmit={onSubmit}
        {...props}
      />
    </ThemeRoot>,
  );
  return { onSubmit };
}

async function choose(label: string, option: RegExp | string) {
  const input = screen.getByRole('combobox', { name: label });
  fireEvent.click(input);
  // each Select keeps its own (hidden) listbox in the DOM: look only in this one
  const listbox = await waitFor(() => {
    const el = document.getElementById(input.getAttribute('aria-controls') ?? '');
    if (!el) throw new Error('listbox not rendered');
    return el;
  });
  fireEvent.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pickType = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

describe('TransactionForm', () => {
  it('shows each account with its balance in the picker', async () => {
    setup();
    fireEvent.click(screen.getByRole('combobox', { name: 'Akun' }));
    const option = await screen.findByRole('option', { name: /BCA/, hidden: true });
    expect(option.textContent).toContain('Rp2.500.000');
  });

  it('switching the type changes the fields', async () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Kategori' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Ke akun' })).toBeNull();
    expect(screen.getByLabelText(/Penerima/)).toBeTruthy();

    pickType('Transfer');
    expect(screen.queryByRole('combobox', { name: 'Kategori' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Dari akun' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Ke akun' })).toBeTruthy();
    expect(screen.getByLabelText(/Biaya admin/)).toBeTruthy();
    expect(screen.queryByLabelText(/Penerima/)).toBeNull();
  });

  it('the category list follows the type (expense vs income)', async () => {
    setup();
    fireEvent.click(screen.getByRole('combobox', { name: 'Kategori' }));
    expect(await screen.findByRole('option', { name: 'Makan', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Gaji', hidden: true })).toBeNull();
    pickType('Pemasukan');
    fireEvent.click(screen.getByRole('combobox', { name: 'Kategori' }));
    expect(await screen.findByRole('option', { name: 'Gaji', hidden: true })).toBeTruthy();
  });

  it('shows validation messages and does not submit an empty form', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nominal wajib diisi')).toBeTruthy();
    expect(screen.getByText('Pilih akun')).toBeTruthy();
    expect(screen.getByText('Pilih kategori')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('expense "1,5jt" submits 150000000 minor units; Enter in a field submits too', async () => {
    const { onSubmit } = setup();
    type('Nominal', '1,5jt');
    expect(screen.getByText('= Rp1.500.000')).toBeTruthy(); // live preview
    await choose('Akun', /BCA/);
    await choose('Kategori', 'Makan');
    fireEvent.submit(screen.getByLabelText('Nominal').closest('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        type: 'expense',
        body: {
          kind: 'expense',
          account_id: A_BCA,
          amount_minor: '150000000',
          category_id: C_FOOD,
          occurred_at: '2026-10-31T09:00:00+07:00',
          note: null,
          payee: null,
        },
      },
      false,
    );
  });

  it('transfer with a fee submits both legs inputs plus the fee entry inputs', async () => {
    const { onSubmit } = setup();
    pickType('Transfer');
    type('Nominal dikirim', '1jt');
    await choose('Dari akun', /BCA/);
    await choose('Ke akun', 'Dompet');
    type('Biaya admin (opsional)', '6500');
    // the default fee category ("Biaya Admin") is preselected once a fee is typed
    expect(screen.getByRole('combobox', { name: 'Kategori biaya' })).toHaveProperty(
      'value',
      'Biaya Admin',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        type: 'transfer',
        body: {
          from_account_id: A_BCA,
          to_account_id: A_CASH,
          amount_minor: '100000000',
          to_amount_minor: null,
          fee_minor: '650000',
          fee_category_id: C_FEE,
          occurred_at: '2026-10-31T09:00:00+07:00',
          note: null,
        },
      },
      false,
    );
  });

  it('transfer between accounts of the same account is rejected, cross-currency asks for the received amount', async () => {
    const { onSubmit } = setup();
    pickType('Transfer');
    type('Nominal dikirim', '1jt');
    await choose('Dari akun', /BCA/);
    await choose('Ke akun', /BCA/);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Akun tujuan harus berbeda dari akun asal')).toBeTruthy();

    await choose('Ke akun', /Wise/);
    expect(screen.getByLabelText(/Jumlah diterima \(USD\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Isi jumlah yang diterima (mata uang berbeda)')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('"Simpan & tambah lagi" keeps type and account and clears the amount', async () => {
    const { onSubmit } = setup();
    type('Nominal', '50rb');
    await choose('Akun', /BCA/);
    await choose('Kategori', 'Makan');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & tambah lagi' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.anything(), true));
    await waitFor(() =>
      expect((screen.getByLabelText('Nominal') as HTMLInputElement).value).toBe(''),
    );
    expect(screen.getByRole('combobox', { name: 'Akun' })).toHaveProperty('value', 'BCA');
  });

  it('edit mode: prefilled, type locked, no "tambah lagi", delete available', () => {
    const onDelete = vi.fn();
    setup({
      mode: 'edit',
      initial: {
        ...emptyTxForm('2026-10-31'),
        type: 'income',
        amount_text: '5000000',
        account_id: A_BCA,
        category_id: C_SALARY,
        time: '08:00',
      },
      onDelete,
    });
    expect((screen.getByLabelText('Nominal') as HTMLInputElement).value).toBe('5000000');
    expect(screen.getByRole('combobox', { name: 'Kategori' })).toHaveProperty('value', 'Gaji');
    expect(screen.getByRole('radio', { name: 'Transfer' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /tambah lagi/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('shows the server error text', () => {
    setup({ error: 'Akun ini sudah diarsipkan.' });
    expect(screen.getByRole('alert').textContent).toContain('diarsipkan');
  });
});
