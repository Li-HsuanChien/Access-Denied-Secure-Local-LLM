import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices, useDocumentViewer } from '../../../../react/providers';
import { AppShell, SHELL_SEARCH_ATTRIBUTE } from './AppShell';

beforeEach(() => {
 localStorage.clear(); window.history.replaceState(null, '', '/library');
 document.documentElement.removeAttribute('data-theme'); document.documentElement.classList.remove('dark');
 Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
 window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const today = new Date().toISOString();
const threads = [
 { conversation_id: 'a', title: 'Pump inspections', updated_at: today, model_id: null, collection_version: null },
 { conversation_id: 'b', title: 'Old drill notes', updated_at: '2020-01-02T00:00:00Z', model_id: null, collection_version: null }
];
function mount(children = <p>Feature content</p>, rows: typeof threads = []) {
 const services = createDefaultServices();
 services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 1, chunk_count: 2 }, answering: { ready: true } } as any));
 services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
 services.settings.update = vi.fn(async value => value);
 services.history.list = vi.fn(async () => rows);
 services.history.remove = vi.fn(async () => true);
 services.history.enabled = vi.fn(async () => true);
 const runtime = createAppRuntime(services, window);
 render(<AppProviders runtime={runtime}><AppShell>{children}</AppShell></AppProviders>);
 return runtime;
}
const openStatus = async () => { fireEvent.click(await screen.findByRole('button', { name: /Assistant status/ })); return screen.findByRole('dialog'); };

it('shows readiness from health and re-checks through the shared service', async () => {
 const runtime = mount();
 await screen.findByText('Ready');
 const status = await openStatus();
 expect(within(status).getByText('1 document · 2 passages')).toBeTruthy();
 fireEvent.click(within(status).getByRole('button', { name: 'Check again' }));
 await waitFor(() => expect(runtime.services.answering.health).toHaveBeenCalledTimes(2));
 expect(screen.getByText('Feature content')).toBeTruthy();
 fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(document.activeElement).toBe(screen.getByRole('button', { name: /Assistant status/ }));
});
it('navigates and resets chat; Ctrl+Shift+O is not a shortcut', () => {
 const runtime = mount();
 fireEvent.click(screen.getByRole('link', { name: 'New Chat' }));
 expect(runtime.navigation.getSnapshot()).toEqual({ path: '/', chatEpoch: 1, temporary: false });
 fireEvent.keyDown(window, { key: 'o', ctrlKey: true, shiftKey: true });
 expect(runtime.navigation.getSnapshot().chatEpoch).toBe(1);
 fireEvent.click(screen.getByRole('link', { name: 'Search chats' }));
 expect(runtime.navigation.getSnapshot().path).toBe('/history');
});
it('persists desktop collapse, restores from the top bar, and toggles with Ctrl+B', () => {
 mount(); fireEvent.click(screen.getByRole('button', { name: 'Close Sidebar' }));
 expect(localStorage.sidebar).toBe('false');
 expect(document.getElementById('sidebar')!.hasAttribute('inert')).toBe(true);
 fireEvent.click(screen.getByRole('button', { name: 'Open Sidebar' }));
 expect(localStorage.sidebar).toBe('true');
 fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
 expect(localStorage.sidebar).toBe('false');
 fireEvent.keyDown(window, { key: 'b', metaKey: true });
 expect(localStorage.sidebar).toBe('true');
});
it('Ctrl+K opens chat search and focuses the search field History marks', async () => {
 const runtime = mount(<input aria-label="Search" {...{ [SHELL_SEARCH_ATTRIBUTE]: '' }} />);
 fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
 expect(runtime.navigation.getSnapshot().path).toBe('/history');
 await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search')));
});
it('uses a drawer below 860px: focus moves in, Escape closes and returns focus, navigation closes it', async () => {
 window.innerWidth = 390; const runtime = mount();
 const sidebar = document.getElementById('sidebar')!;
 expect(sidebar.getAttribute('data-open')).toBe('false');
 const menu = screen.getByRole('button', { name: 'Open menu' });
 menu.focus(); fireEvent.click(menu);
 expect(sidebar.getAttribute('data-open')).toBe('true');
 await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'New Chat' })));
 fireEvent.keyDown(document, { key: 'Escape' });
 expect(sidebar.getAttribute('data-open')).toBe('false');
 await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' })));
 fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
 // The open drawer is modal: content under the scrim is inert.
 expect(document.querySelector('.shell-main-column')!.hasAttribute('inert')).toBe(true);
 await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'New Chat' })));
 fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
 expect(runtime.navigation.getSnapshot().path).toBe('/settings');
 expect(sidebar.getAttribute('data-open')).toBe('false');
 expect(document.querySelector('.shell-main-column')!.hasAttribute('inert')).toBe(false);
 // Focus leaves the now-inert nav for the page.
 await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main-content')));
 // Drawer state is not persisted; only the desktop collapse preference is.
 expect(localStorage.sidebar).toBeUndefined();
});
it('closes the drawer from its scrim', () => {
 window.innerWidth = 390; mount();
 fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
 fireEvent.click(document.querySelector('.shell-drawer-scrim')!);
 expect(document.getElementById('sidebar')!.getAttribute('data-open')).toBe('false');
});
it('retains the confirmed general-knowledge preference and shows the error copy on save failure', async () => {
 const runtime = mount();
 const status = await openStatus();
 const toggle = within(status).getByRole('switch', { name: 'Include general model knowledge' });
 await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
 runtime.services.settings.update = vi.fn(async () => { throw new Error('failure'); });
 fireEvent.click(toggle);
 const alert = await within(status).findByRole('alert');
 expect(alert.textContent).toBe('Could not save this preference. Please retry.');
 expect(toggle.getAttribute('aria-checked')).toBe('true');
});
it('applies the stored theme to the document and becomes a drawer at the compact breakpoint', () => {
 localStorage.theme = 'dark'; mount();
 expect(document.documentElement.classList.contains('dark')).toBe(true);
 expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
 act(() => { window.innerWidth = 859; fireEvent(window, new Event('resize')); });
 expect(document.getElementById('sidebar')!.getAttribute('data-open')).toBe('false');
 expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
});
it('follows the system theme when the preference is system', () => {
 window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
 mount();
 expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
});
it('reports an unavailable local service with its error message', async () => {
 const runtime = mount(); await screen.findByText('Ready');
 runtime.services.answering.health = vi.fn(async () => { throw new Error('Local service unavailable'); });
 const status = await openStatus();
 fireEvent.click(within(status).getByRole('button', { name: 'Check again' }));
 await screen.findByText('Unavailable');
 expect(within(status).getByText('Local service unavailable')).toBeTruthy();
});
it('presents an empty Library as a normal first-run state when the model is ready', async () => {
 const runtime = mount(); await screen.findByText('Ready');
 runtime.services.answering.health = vi.fn(async () => ({ ready: false, answering: { ready: true }, library: { ready: false, document_count: 0, chunk_count: 0 } } as any));
 const status = await openStatus();
 fireEvent.click(within(status).getByRole('button', { name: 'Check again' }));
 await screen.findByText('Add documents');
 expect(within(status).getByText('Local model ready. Publish documents to your Library to start asking questions.')).toBeTruthy();
 expect(screen.queryByText('Unavailable')).toBeNull();
});
it('keeps the Open WebUI credit and logo visible in the sidebar', () => {
 mount();
 const sidebar = screen.getByRole('navigation', { name: 'Chat history' });
 expect(within(sidebar).getByText('Built on Open WebUI')).toBeTruthy();
 expect(within(sidebar).getByRole('img', { name: 'Open WebUI logo' }).getAttribute('src')).toBe('/static/favicon.png');
});
it('groups saved threads by date and shows the open thread title', async () => {
 window.history.replaceState(null, '', '/conversation/a');
 mount(undefined, threads);
 const today = await screen.findByRole('region', { name: 'Today' });
 expect(within(today).getByRole('link', { name: 'Pump inspections' }).getAttribute('aria-current')).toBe('page');
 expect(within(screen.getByRole('region', { name: 'Older' })).getByRole('link', { name: 'Old drill notes' })).toBeTruthy();
 expect(screen.getByRole('heading', { level: 1, name: 'Pump inspections' })).toBeTruthy();
});
it('deletes a thread only after confirmation through the history interface', async () => {
 window.history.replaceState(null, '', '/conversation/a');
 const runtime = mount(undefined, threads);
 const more = await screen.findByRole('button', { name: 'More options for Pump inspections' });
 fireEvent.click(more);
 const menu = await screen.findByRole('menu', { name: 'Conversation options' });
 await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Delete…' })));
 fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete…' }));
 let dialog = await screen.findByRole('alertdialog', { name: 'Delete this conversation?' });
 expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
 fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
 expect(runtime.services.history.remove).not.toHaveBeenCalled();
 await waitFor(() => expect(document.activeElement).toBe(more));
 fireEvent.click(more);
 fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
 dialog = await screen.findByRole('alertdialog');
 (runtime.services.history.list as any).mockResolvedValue([threads[1]]);
 fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
 await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
 expect(runtime.services.history.remove).toHaveBeenCalledWith('a');
 expect(runtime.navigation.getSnapshot().path).toBe('/');
 await waitFor(() => expect(screen.queryByRole('link', { name: 'Pump inspections' })).toBeNull());
});
it('keeps the confirmation open with an error when delete fails', async () => {
 const runtime = mount(undefined, threads);
 runtime.services.history.remove = vi.fn(async () => { throw new Error('Disk is busy.'); });
 fireEvent.click(await screen.findByRole('button', { name: 'More options for Pump inspections' }));
 fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
 const dialog = await screen.findByRole('alertdialog');
 fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
 expect((await within(dialog).findByRole('alert')).textContent).toBe('Disk is busy. Nothing was changed. Try again.');
 expect(screen.getByRole('link', { name: 'Pump inspections' })).toBeTruthy();
});
it('toggles a temporary chat through the existing route flag', () => {
 window.history.replaceState(null, '', '/');
 const runtime = mount();
 fireEvent.click(screen.getByRole('link', { name: 'Start temporary chat' }));
 expect(runtime.navigation.getSnapshot().temporary).toBe(true);
 expect(window.location.search).toBe('?local-temporary=true');
 expect(screen.getByText('Temporary')).toBeTruthy();
 fireEvent.click(screen.getByRole('link', { name: 'Start saved chat' }));
 expect(runtime.navigation.getSnapshot().temporary).toBe(false);
 expect(screen.queryByText('Temporary')).toBeNull();
});

function ViewerTrigger({ load }: { load: () => Promise<ArrayBuffer> }) {
 const viewer = useDocumentViewer();
 return <button type="button" onClick={() => viewer.open({ title: 'Maintenance handbook', subtitle: 'Page 4', page: 4, load })}>Show document page</button>;
}
it('opens the document viewer as a side panel at wide widths and restores focus on Escape', async () => {
 const load = vi.fn(() => new Promise<ArrayBuffer>(() => undefined));
 mount(<ViewerTrigger load={load} />);
 expect(load).not.toHaveBeenCalled();
 const trigger = screen.getByRole('button', { name: 'Show document page' });
 trigger.focus(); fireEvent.click(trigger);
 const panel = screen.getByRole('complementary', { name: 'Document viewer' });
 expect(within(panel).getByRole('heading', { name: 'Maintenance handbook' })).toBeTruthy();
 expect(within(panel).getByText('Page 4')).toBeTruthy();
 expect(load).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('dialog')).toBeNull();
 await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
 fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
 expect(screen.queryByRole('complementary', { name: 'Document viewer' })).toBeNull();
 await waitFor(() => expect(document.activeElement).toBe(trigger));
});
it('opens the document viewer as a full-screen modal dialog below 1180px', async () => {
 window.innerWidth = 1000;
 const load = vi.fn(async () => { throw new Error('The source document could not be opened.'); });
 mount(<ViewerTrigger load={load} />);
 const trigger = screen.getByRole('button', { name: 'Show document page' });
 trigger.focus(); fireEvent.click(trigger);
 const dialog = screen.getByRole('dialog', { name: 'Maintenance handbook, document viewer' });
 expect(dialog.getAttribute('aria-modal')).toBe('true');
 expect(document.querySelector('.shell')!.closest('[inert]')).toBeTruthy();
 expect((await within(dialog).findByRole('alert')).textContent).toContain('The source document could not be opened.');
 fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
 await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
 fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(document.querySelector('[inert]')).toBeNull();
 await waitFor(() => expect(document.activeElement).toBe(trigger));
});
