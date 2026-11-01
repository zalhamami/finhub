import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isActivePath, isTabActive } from '../src/components/nav';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

afterEach(() => vi.unstubAllGlobals());

let router: ReturnType<typeof createAppRouter>;
async function renderAt(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 500 })),
  );
  router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <ThemeRoot>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeRoot>,
  );
  // the tab bar is part of the shell
  return within(await screen.findByRole('navigation', { name: 'Navigasi utama' }));
}

describe('navigation active state', () => {
  it('isActivePath', () => {
    expect(isActivePath('/akun', '/akun')).toBe(true);
    expect(isActivePath('/akun', '/akun/1')).toBe(true);
    expect(isActivePath('/akun', '/akunx')).toBe(false);
  });

  it('"/" lands on Beranda (old bookmarks), whose tab is active', async () => {
    const tabs = await renderAt('/');
    expect(tabs.getByRole('link', { name: 'Beranda' }).getAttribute('aria-current')).toBe('page');
    expect(tabs.getByRole('link', { name: 'Transaksi' }).getAttribute('aria-current')).toBeNull();
    expect(router.state.location.pathname).toBe('/beranda');
  });

  it('five mobile tabs: Beranda, Transaksi, Tambah (center), Akun, Lainnya', async () => {
    const tabs = await renderAt('/beranda');
    const items = [...tabs.getAllByRole('link'), ...tabs.getAllByRole('button')];
    expect(items).toHaveLength(5);
    const labels = Array.from(
      document.querySelectorAll('nav[aria-label="Navigasi utama"] > *'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(['Beranda', 'Transaksi', 'Tambah', 'Akun', 'Lainnya']);
    expect(tabs.queryByText('Kekayaan')).toBeNull();
  });

  it('Kekayaan (/kekayaan) lives under Lainnya', async () => {
    const tabs = await renderAt('/kekayaan');
    expect(tabs.getByRole('link', { name: 'Lainnya' }).getAttribute('aria-current')).toBe('page');
    expect(tabs.getByRole('link', { name: 'Beranda' }).getAttribute('aria-current')).toBeNull();
  });

  it('Lainnya is active on /pengaturan; Tambah is never "current"', async () => {
    const tabs = await renderAt('/pengaturan');
    expect(tabs.getByRole('link', { name: 'Lainnya' }).getAttribute('aria-current')).toBe('page');
    expect(
      tabs.getByRole('button', { name: 'Tambah transaksi' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('the center Tambah tab opens the add-transaction sheet', async () => {
    const tabs = await renderAt('/akun');
    fireEvent.click(tabs.getByRole('button', { name: 'Tambah transaksi' }));
    expect(await screen.findByRole('dialog', { name: 'Tambah transaksi' })).toBeTruthy();
  });

  it('Kategori lives under the Lainnya tab', () => {
    const lainnya = { to: '/pengaturan', also: ['/kekayaan', '/kategori'] };
    expect(isTabActive(lainnya, '/kategori')).toBe(true);
    expect(isTabActive(lainnya, '/pengaturan/jenis-akun')).toBe(true);
    expect(isTabActive(lainnya, '/akun')).toBe(false);
  });
});
