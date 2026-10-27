import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import { createI18nBridge } from '../../../../react/i18n/bridge';
import { AppShell } from './AppShell';
import { usePinnedModel } from './PinnedModel';

const localization = vi.hoisted(() => ({ current: null as ReturnType<typeof createI18nBridge> | null }));
vi.mock('@/react/i18n', () => ({ useI18n: () => ({ t: localization.current!.t, language: localization.current!.language }) }));

beforeEach(() => {
 localStorage.clear();
 Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
 window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function PinControl() { const {setPinned} = usePinnedModel(); return <button onClick={() => setPinned(true)}>Keep model</button>; }
async function mount(locale: string, collapsed = false, pinControl = false) {
 window.history.replaceState(null, '', `/library?lang=${locale}`);
 localStorage.sidebar = collapsed ? 'false' : 'true';
 const bridge = createI18nBridge();
 await bridge.initialize(); localization.current = bridge;
 const services = createDefaultServices();
 services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 1, chunk_count: 2 }, answering: {} } as any));
 services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
 services.settings.update = vi.fn(async value => value);
 services.history.list = vi.fn(async () => []);
 services.history.enabled = vi.fn(async () => true);
 const runtime = createAppRuntime(services, window);
 render(<AppProviders runtime={runtime}><AppShell><p>Feature content</p>{pinControl && <PinControl />}</AppShell></AppProviders>);
 return runtime;
}
it.each([
 ['fr-FR', 'Nouvelle conversation', 'Chat history', 'Fermer la barre latérale'],
 ['de-DE', 'Neuer Chat', 'Chatverlauf', 'Seitenleiste schließen']
])('restores original expanded native shell labels in %s while retaining product English', async (locale, newChat, history, close) => {
 const runtime = await mount(locale);
 expect(screen.getByRole('navigation', { name: history })).toBeTruthy();
 const link = screen.getByRole('link', { name: newChat });
 expect(link.textContent).toContain(newChat);
 expect(screen.getByRole('button', { name: close })).toBeTruthy();
 for(const label of ['Library', 'History', 'Settings']) expect(screen.getByRole('link', { name: label })).toBeTruthy();
 expect(screen.getByText('Local workspace')).toBeTruthy();
 expect(screen.getByText('Include general model knowledge')).toBeTruthy();
 expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
 await screen.findByText('1 document · 2 passages · local model ready');
 fireEvent.click(link);
 expect(runtime.navigation.getSnapshot()).toEqual({ path: '/', chatEpoch: 1, temporary: false });
});
it.each([
 ['fr-FR', 'Nouvelle conversation', 'Chat history', 'Ouvrir la barre latérale'],
 ['de-DE', 'Neuer Chat', 'Chatverlauf', 'Seitenleiste öffnen']
])('restores rail navigation accessibility and tooltip text in %s', async (locale, newChat, history, open) => {
 await mount(locale, true);
 expect(screen.getByRole('navigation', { name: history })).toBeTruthy();
 expect(screen.getByRole('link', { name: newChat })).toBeTruthy();
 const button = screen.getByRole('button', { name: open });
 fireEvent.mouseEnter(button.parentElement!);
 await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(open));
});
it('retains the original hardcoded English mobile menu label in a localized shell', async () => {
 window.innerWidth = 390;
 await mount('fr-FR');
 fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
 expect(screen.getByRole('link', { name: 'Nouvelle conversation' })).toBeTruthy();
});
it('retains original English native keys through catalog fallback', async () => {
 await mount('en-US');
 expect(screen.getByRole('navigation', { name: 'Chat history' })).toBeTruthy();
 expect(screen.getByRole('button', { name: 'Close Sidebar' })).toBeTruthy();
 expect(screen.getByRole('link', { name: 'New Chat' }).textContent).toContain('New Chat');
});

it.each([['fr-FR', 'Modèles', 'Désépingler'], ['de-DE', 'Modelle', 'Lösen']])('preserves localized pinned section and Shift-hover Unpin tooltip in %s', async (locale, models, unpinLabel) => {
 await mount(locale, false, true);
 fireEvent.click(screen.getByText('Keep model'));
 expect(screen.getByRole('button', {name:models})).toBeTruthy();
 expect(screen.getByRole('link', {name:'logo Document Assistant'})).toBeTruthy();
 const row = document.querySelector('#pinned-models-list [data-id="secure-qa-local"]')!;
 fireEvent.mouseEnter(row); fireEvent.keyDown(window, {key:'Shift'});
 const unpin = row.querySelector('button')!;
 fireEvent.mouseEnter(unpin.parentElement!);
 await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(unpinLabel));
 fireEvent.click(unpin);
 expect(screen.queryByRole('button', {name:models})).toBeNull();
 fireEvent.keyUp(window, {key:'Shift'});
});
