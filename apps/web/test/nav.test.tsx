import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isActivePath, isTabActive } from '../src/components/nav';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

afterEach(() => vi.unstubAllGlobals());

async function renderAt(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 500 })),
  );
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
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
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/', '/akun')).toBe(false);
    expect(isActivePath('/akun', '/akun')).toBe(true);
    expect(isActivePath('/akun', '/akun/1')).toBe(true);
    expect(isActivePath('/akun', '/akunx')).toBe(false);
  });

  it('on the net worth page the Kekayaan tab is active and there is no Beranda tab', async () => {
    const tabs = await renderAt('/');
    expect(tabs.queryByText('Beranda')).toBeNull();
    expect(tabs.getByRole('link', { name: 'Kekayaan' }).getAttribute('aria-current')).toBe('page');
    expect(tabs.getByRole('link', { name: 'Transaksi' }).getAttribute('aria-current')).toBeNull();
  });

  it('Lainnya is active on /pengaturan and Kekayaan is not', async () => {
    const tabs = await renderAt('/pengaturan');
    expect(tabs.getByRole('link', { name: 'Lainnya' }).getAttribute('aria-current')).toBe('page');
    expect(tabs.getByRole('link', { name: 'Kekayaan' }).getAttribute('aria-current')).toBeNull();
  });

  it('Kategori lives under the Lainnya tab', () => {
    const lainnya = { to: '/pengaturan', also: ['/kategori'] };
    expect(isTabActive(lainnya, '/kategori')).toBe(true);
    expect(isTabActive(lainnya, '/pengaturan/jenis-akun')).toBe(true);
    expect(isTabActive(lainnya, '/akun')).toBe(false);
  });
});
