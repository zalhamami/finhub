import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

const realMatchMedia = window.matchMedia;
afterEach(() => {
  vi.unstubAllGlobals();
  window.matchMedia = realMatchMedia;
});

function stubDesktop(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderApp() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
  render(
    <ThemeRoot>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider
          router={createAppRouter(createMemoryHistory({ initialEntries: ['/akun'] }))}
        />
      </QueryClientProvider>
    </ThemeRoot>,
  );
}

describe('add-transaction entry points', () => {
  it('the header button opens the form (no more M2 placeholder)', async () => {
    stubDesktop(true);
    renderApp();
    const buttons = await screen.findAllByRole('button', { name: /Tambah transaksi/ });
    fireEvent.click(buttons[0]!);
    expect(await screen.findByRole('dialog', { name: 'Tambah transaksi' })).toBeTruthy();
    expect(screen.queryByText(/hadir di M2/)).toBeNull();
  });

  it('the mobile FAB opens the form', async () => {
    stubDesktop(false);
    renderApp();
    // jsdom has no CSS, so the (desktop-only) header button is in the DOM too; the FAB is last
    const buttons = await screen.findAllByRole('button', { name: /Tambah transaksi/ });
    fireEvent.click(buttons.at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'Tambah transaksi' })).toBeTruthy();
  });

  it('"n" opens the form on desktop, but not while typing in a field', async () => {
    stubDesktop(true);
    renderApp();
    await screen.findAllByRole('button', { name: /Tambah transaksi/ });

    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: 'n' });
    expect(screen.queryByRole('dialog')).toBeNull();
    field.remove();

    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document.body, { key: 'n' });
    expect(await screen.findByRole('dialog', { name: 'Tambah transaksi' })).toBeTruthy();
  });

  it('"n" does nothing on mobile', async () => {
    stubDesktop(false);
    renderApp();
    await screen.findAllByRole('button', { name: /Tambah transaksi/ });
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
