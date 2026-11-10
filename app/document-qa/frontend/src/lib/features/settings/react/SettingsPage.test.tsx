import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import type { SavedConversation } from '../../react-contracts';
import { SettingsPage } from './SettingsPage';
import { HistoryPage } from '../../history/react/HistoryPage';

const saved: SavedConversation[] = [
  { conversation_id: 'a', title: 'One', updated_at: '2026-10-20 10:15', model_id: null, collection_version: null },
  { conversation_id: 'b', title: 'Two', updated_at: '2026-10-20 10:16', model_id: null, collection_version: null }
];
const healthy = { ready: true, library: { document_count: 1, chunk_count: 12 }, answering: { ready: true } } as any;
function servicesFor() {
  const services = createDefaultServices();
  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  services.settings.update = vi.fn(async value => value);
  services.history.list = vi.fn(async () => saved);
  services.history.clear = vi.fn(async () => undefined);
  services.history.enabled = vi.fn(async () => true);
  services.history.setEnabled = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => healthy);
  return services;
}
function mount(services = servicesFor(), strict = false) {
  const runtime = createAppRuntime(services, window);
  const tree = <AppProviders runtime={runtime}><SettingsPage /></AppProviders>;
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return runtime;
}
const computer = () => screen.getByRole('region', { name: 'This computer' });
const ready = () => waitFor(() => expect(within(computer()).getByRole('status').textContent).toBe('Ready'));
afterEach(() => { cleanup(); try { localStorage.removeItem('theme'); } catch { /* ignore */ } });

it('shows local readiness from health and refreshes host health and shared preferences', async () => {
  const runtime = mount();
  await ready();
  expect(within(computer()).getByText('1 document · 12 passages in use')).toBeTruthy();
  expect(within(computer()).getByText(/Offline\. Nothing leaves this computer\./)).toBeTruthy();
  const healthCalls = (runtime.services.answering.health as ReturnType<typeof vi.fn>).mock.calls.length;
  const readCalls = (runtime.services.settings.read as ReturnType<typeof vi.fn>).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect((runtime.services.answering.health as ReturnType<typeof vi.fn>).mock.calls.length).toBe(healthCalls + 1));
  await waitFor(() => expect((runtime.services.settings.read as ReturnType<typeof vi.fn>).mock.calls.length).toBe(readCalls + 1));
  expect(runtime.services.history.enabled).toHaveBeenCalledTimes(readCalls + 1);
});

it('shows the required Open WebUI credit and logo in About', async () => {
  mount();
  const about = screen.getByRole('region', { name: 'About' });
  expect(within(about).getByText('Built on Open WebUI')).toBeTruthy();
  expect(within(about).getByRole('img', { name: 'Open WebUI logo' }).getAttribute('src')).toBe('/static/favicon.png');
});

it('updates general knowledge in the shared provider with Saving/Saved and retains the confirmed value on failure', async () => {
  const runtime = mount();
  await ready();
  const general = screen.getByRole('switch', { name: /Include general model knowledge by default/ }) as HTMLInputElement;
  fireEvent.click(general);
  await screen.findByText('Saved');
  expect(runtime.preferences.getSnapshot().generalKnowledge).toBe(false);
  expect(general.checked).toBe(false);
  runtime.services.settings.update = vi.fn(async () => { throw new Error('Preference write failed'); });
  fireEvent.click(general);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('Preference write failed')).toBeTruthy();
  expect(alert.textContent).toContain('Your previous setting is kept. Try again.');
  await waitFor(() => expect(general.checked).toBe(false));
  expect(runtime.preferences.getSnapshot().generalKnowledge).toBe(false);
});

it('keeps history persistence synchronized through the History interface', async () => {
  const runtime = mount();
  await ready();
  const history = screen.getByRole('switch', { name: 'Save conversations on this computer' });
  fireEvent.click(history);
  await screen.findByText('Saved');
  expect(runtime.preferences.getSnapshot().historyEnabled).toBe(false);
  expect(runtime.services.history.setEnabled).toHaveBeenCalledWith(false);
});

it('shows preference writes in a second subscriber using the same runtime', async () => {
  const services = servicesFor();
  services.history.list = vi.fn(async () => []);
  const runtime = createAppRuntime(services, window);
  render(<AppProviders runtime={runtime}><SettingsPage /><HistoryPage /></AppProviders>);
  await ready();
  expect(screen.queryByText('History is off. New chats aren’t saved.')).toBeNull();
  fireEvent.click(screen.getByRole('switch', { name: 'Save conversations on this computer' }));
  await screen.findByText('History is off. New chats aren’t saved.');
  expect(runtime.preferences.getSnapshot().historyEnabled).toBe(false);
});

it('deletes all saved conversations only after inline confirmation and returns focus', async () => {
  const runtime = mount();
  const trigger = await screen.findByRole('button', { name: 'Delete all…' });
  await screen.findByText('2 conversations saved on this computer.');
  fireEvent.click(trigger);
  const group = screen.getByRole('group', { name: /Delete all 2 conversations\?/ });
  expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
  expect(runtime.services.history.clear).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete all…' }));

  fireEvent.click(screen.getByRole('button', { name: 'Delete all…' }));
  fireEvent.keyDown(screen.getByRole('group', { name: /Delete all/ }), { key: 'Escape' });
  expect(runtime.services.history.clear).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete all…' }));

  runtime.services.history.list = vi.fn(async () => []);
  fireEvent.click(screen.getByRole('button', { name: 'Delete all…' }));
  fireEvent.click(within(screen.getByRole('group', { name: /Delete all/ })).getByRole('button', { name: 'Delete all' }));
  await waitFor(() => expect(runtime.services.history.clear).toHaveBeenCalledTimes(1));
  await screen.findByText('There are no saved conversations.');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'History' }));
});

it('keeps everything when clearing history fails', async () => {
  const services = servicesFor();
  services.history.clear = vi.fn(async () => { throw new Error('Clear refused.'); });
  mount(services);
  await screen.findByText('2 conversations saved on this computer.');
  fireEvent.click(screen.getByRole('button', { name: 'Delete all…' }));
  fireEvent.click(within(screen.getByRole('group', { name: /Delete all/ })).getByRole('button', { name: 'Delete all' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Clear refused. Nothing was deleted. Try again.');
  expect(screen.getByText('2 conversations saved on this computer.')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete all…' }));
});

it('switches theme between System, Light and Dark through the frontend preference', async () => {
  mount();
  const group = screen.getByRole('radiogroup', { name: 'Theme' });
  expect(within(group).getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
  expect(within(group).getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  fireEvent.click(within(group).getByRole('radio', { name: 'Light' }));
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  fireEvent.click(within(group).getByRole('radio', { name: 'System' }));
});

it('shows a settings read failure separately from health readiness and clears it after a successful read', async () => {
  const services = servicesFor();
  services.settings.read = vi.fn(async () => { throw new Error('Local settings are unavailable.'); });
  const runtime = mount(services, true);
  expect((await screen.findByRole('alert')).textContent).toBe('Local settings are unavailable.');
  expect(runtime.preferences.getSnapshot().errors.generalKnowledge).toBe('Local settings are unavailable.');
  await ready();

  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

  services.settings.read = vi.fn(async () => { throw new Error('Local settings are unavailable.'); });
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Local settings are unavailable.');
});

it('surfaces a delayed provider read failure even when a newer page refresh settles first', async () => {
  const services = servicesFor();
  const reads: Array<{ reject: (reason: Error) => void }> = [];
  services.settings.read = vi.fn(() => new Promise((_resolve, reject) => { reads.push({ reject }); }));
  const runtime = mount(services, true);
  await waitFor(() => expect(reads.length).toBeGreaterThanOrEqual(2));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(reads.length).toBeGreaterThanOrEqual(3));
  reads[reads.length - 1].reject(new Error('Delayed settings failure.'));
  expect((await screen.findByRole('alert')).textContent).toBe('Delayed settings failure.');
  expect(runtime.preferences.getSnapshot().errors.generalKnowledge).toBe('Delayed settings failure.');
});
