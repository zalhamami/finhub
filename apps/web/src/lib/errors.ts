import { ApiRequestError } from './api';

export type ErrorContext = 'account' | 'account-type' | 'category' | 'transaction' | 'generic';

const BY_CODE: Record<string, string> = {
  account_has_entries:
    'Akun ini sudah punya transaksi, jadi tidak bisa dihapus atau diganti mata uangnya. Arsipkan saja agar tidak muncul lagi.',
  account_type_in_use:
    'Jenis akun ini masih dipakai oleh akun. Pindahkan atau hapus akun tersebut dulu.',
  category_in_use:
    'Kategori ini sudah dipakai transaksi, jadi tidak bisa dihapus. Arsipkan saja agar tidak muncul lagi.',
  category_has_children:
    'Kategori ini masih punya subkategori. Hapus atau pindahkan subkategorinya dulu.',
  parent_archived: 'Kategori induk sedang diarsipkan. Aktifkan induknya terlebih dahulu.',
  category_kind_mismatch: 'Induk harus berjenis sama (pengeluaran atau pemasukan).',
  category_cycle: 'Kategori tidak bisa menjadi induk dari dirinya sendiri.',
  unique_violation: 'Nama itu sudah dipakai. Gunakan nama lain.',
  foreign_key_violation: 'Data ini masih terhubung dengan data lain.',
  validation_error: 'Isian belum valid. Periksa kembali formulir.',
};

/** Codes whose wording depends on where they happened. */
const BY_CONTEXT: Partial<Record<ErrorContext, Record<string, string>>> = {
  transaction: {
    ledger_invalid:
      'Transaksi tidak seimbang atau tidak lengkap. Periksa akun, nominal, dan biaya transfer.',
    category_kind_mismatch:
      'Kategori tidak cocok dengan jenis transaksi. Pilih kategori pengeluaran untuk pengeluaran dan kategori pemasukan untuk pemasukan.',
    account_archived: 'Akun ini sudah diarsipkan. Pilih akun lain atau aktifkan kembali akunnya.',
    invalid_reference:
      'Akun atau kategori yang dipilih tidak ditemukan. Muat ulang halaman lalu pilih lagi.',
    not_found: 'Transaksi ini sudah tidak ada. Muat ulang daftar transaksi.',
  },
};

/** API error -> Indonesian message for the user. Unknown codes fall back to a generic text. */
export function friendlyError(err: unknown, context: ErrorContext = 'generic'): string {
  if (err instanceof ApiRequestError) {
    if (err.code && BY_CONTEXT[context]?.[err.code]) return BY_CONTEXT[context]![err.code]!;
    if (err.code && BY_CODE[err.code]) return BY_CODE[err.code]!;
    if (err.status === 409)
      return 'Tindakan ini bentrok dengan data yang ada. Muat ulang lalu coba lagi.';
    if (err.status === undefined || err.status >= 500)
      return 'Server bermasalah atau tidak terjangkau. Coba lagi sebentar lagi.';
  }
  return 'Terjadi kesalahan. Coba lagi.';
}
