import { useMantineTheme } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from '@tanstack/react-router';
import { RouterProvider, createAppRouter } from '../src/router';
import { ThemeRoot } from '../src/theme/AccentProvider';

function Probe() {
  return <output data-testid="primary">{useMantineTheme().primaryColor}</output>;
}

const calls: { method?: string; body?: string }[] = [];
beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method, body: init?.body });
      const accent = init?.body ? (JSON.parse(init.body) as { accent: string }).accent : 'amber';
      return new Response(JSON.stringify({ data: { accent } }), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/pengaturan'] }));
  render(
    <ThemeRoot>
      <QueryClientProvider client={client}>
        <Probe />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeRoot>,
  );
  await screen.findByText('Warna aksen');
}

describe('SettingsPage accent picker', () => {
  it('choosing a preset changes the theme primaryColor, saves it and caches it', async () => {
    await renderSettings();
    expect(screen.getByTestId('primary').textContent).toBe('amber');
    fireEvent.click(screen.getByRole('button', { name: /Jade/ }));
    expect(screen.getByTestId('primary').textContent).toBe('jade');
    fireEvent.click(screen.getByRole('button', { name: /Indigo/ }));
    expect(screen.getByTestId('primary').textContent).toBe('indigo');
    expect(localStorage.getItem('finhub.accent')).toBe('indigo');
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ accent: 'indigo' });
  });

  it('a valid custom hex switches to the generated custom palette', async () => {
    await renderSettings();
    fireEvent.change(screen.getByLabelText('Warna kustom'), { target: { value: '#c2410c' } });
    expect(screen.getByTestId('primary').textContent).toBe('custom');
  });

  it('the first paint uses the cached accent', async () => {
    localStorage.setItem('finhub.accent', 'jade');
    await renderSettings();
    expect(screen.getByTestId('primary').textContent).toBe('jade');
  });

  it('renders the preview in light and dark', async () => {
    await renderSettings();
    expect(screen.getByText('Mode terang')).toBeTruthy();
    expect(screen.getByText('Mode gelap')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Simpan' })).toHaveLength(2);
  });
});
