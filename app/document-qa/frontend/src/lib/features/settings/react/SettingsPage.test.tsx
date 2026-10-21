import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import { SettingsPage } from './SettingsPage';
import { HistoryPage } from '../../history/react/HistoryPage';

function mount() {
  const services = createDefaultServices();
  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  services.settings.update = vi.fn(async value => value);
  services.history.enabled = vi.fn(async () => true);
  services.history.setEnabled = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 1 }, answering: { ready: true } } as any));
  const runtime = createAppRuntime(services, window);
  render(<AppProviders runtime={runtime}><SettingsPage /></AppProviders>);
  return runtime;
}
afterEach(cleanup);

it('shows local readiness and refreshes host health and shared preferences', async () => {
  const runtime = mount();
  await screen.findByText('Ready · 1 document · local model ready');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(runtime.services.answering.health).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(runtime.services.settings.read).toHaveBeenCalledTimes(3));
  expect(runtime.services.history.enabled).toHaveBeenCalledTimes(3);
});

it('updates general knowledge in the shared provider and retains the confirmed value on failure', async () => {
  const runtime = mount();
  await screen.findByText('Ready · 1 document · local model ready');
  const general = screen.getByRole('switch', { name: /Include general model knowledge by default/ });
  fireEvent.click(general);
  await screen.findByText('General knowledge preference saved and used for new questions.');
  expect(runtime.preferences.getSnapshot().generalKnowledge).toBe(false);
  expect((general as HTMLInputElement).checked).toBe(false);
  runtime.services.settings.update = vi.fn(async () => { throw new Error('Preference write failed'); });
  fireEvent.click(general);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('Preference write failed');
  await waitFor(() => expect((general as HTMLInputElement).checked).toBe(false));
});

it('keeps history persistence synchronized through the shared preference provider', async () => {
  const runtime = mount();
  await screen.findByText('Ready · 1 document · local model ready');
  const history = screen.getByRole('switch', { name: /Save new answers to local conversation history/ });
  fireEvent.click(history);
  await screen.findByText('New answers will not be saved.');
  expect(runtime.preferences.getSnapshot().historyEnabled).toBe(false);
  expect(runtime.services.history.setEnabled).toHaveBeenCalledWith(false);
});


it('shows preference writes in a second subscriber using the same runtime', async () => {
  const services = createDefaultServices();
  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  services.settings.update = vi.fn(async value => value);
  services.history.list = vi.fn(async () => []);
  services.history.enabled = vi.fn(async () => true);
  services.history.setEnabled = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 0 }, answering: { ready: true } } as any));
  const runtime = createAppRuntime(services, window);
  render(<AppProviders runtime={runtime}><SettingsPage /><HistoryPage /></AppProviders>);
  await screen.findByText('Ready · 0 documents · local model ready');
  const switches = screen.getAllByRole('switch');
  fireEvent.click(switches[1]);
  await waitFor(() => expect((screen.getAllByRole('switch')[2] as HTMLInputElement).checked).toBe(false));
  expect(runtime.preferences.getSnapshot().historyEnabled).toBe(false);
});

it('shows the original readiness failure when a settings read fails repeatedly', async () => {
  const services = createDefaultServices();
  services.settings.read = vi.fn(async () => { throw new Error('Local settings are unavailable.'); });
  services.settings.update = vi.fn(async value => value);
  services.history.enabled = vi.fn(async () => true);
  services.history.setEnabled = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 1 }, answering: { ready: true } } as any));
  const runtime = createAppRuntime(services, window);
  render(<StrictMode><AppProviders runtime={runtime}><SettingsPage /></AppProviders></StrictMode>);
  await screen.findByText('The local host could not be reached.');
  expect((await screen.findByRole('alert')).textContent).toBe('Local settings are unavailable.');
  expect(runtime.preferences.getSnapshot().errors.generalKnowledge).toBe('Local settings are unavailable.');

  const readCount = (services.settings.read as ReturnType<typeof vi.fn>).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect((services.settings.read as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(readCount));
  await waitFor(() => expect(document.querySelector('[aria-labelledby="readiness-title"] [role="status"]')?.textContent).toBe('The local host could not be reached.'));

  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Ready · 1 document · local model ready');
  expect(screen.getByRole('alert').textContent).toBe('Local settings are unavailable.');

  services.settings.read = vi.fn(async () => { throw new Error('Local settings are unavailable.'); });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(document.querySelector('[aria-labelledby="readiness-title"] [role="status"]')?.textContent).toBe('The local host could not be reached.'));
  expect(screen.getByRole('alert').textContent).toBe('Local settings are unavailable.');
});

it('surfaces a delayed provider read failure even when a newer page refresh settles first', async () => {
  const services = createDefaultServices();
  const reads: Array<{ reject: (reason: Error) => void }> = [];
  services.settings.read = vi.fn(() => new Promise((_resolve, reject) => { reads.push({ reject }); }));
  services.settings.update = vi.fn(async value => value);
  services.history.enabled = vi.fn(async () => true);
  services.history.setEnabled = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 1 }, answering: { ready: true } } as any));
  const runtime = createAppRuntime(services, window);
  render(<StrictMode><AppProviders runtime={runtime}><SettingsPage /></AppProviders></StrictMode>);
  await waitFor(() => expect(reads.length).toBeGreaterThanOrEqual(2));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(reads.length).toBeGreaterThanOrEqual(3));
  const last = reads[reads.length - 1];
  last.reject(new Error('Delayed settings failure.'));
  await screen.findByText('The local host could not be reached.');
  expect((await screen.findByRole('alert')).textContent).toBe('Delayed settings failure.');
  expect(runtime.preferences.getSnapshot().errors.generalKnowledge).toBe('Delayed settings failure.');
});
