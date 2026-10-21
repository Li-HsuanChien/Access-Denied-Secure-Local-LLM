import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import { AppShell } from './AppShell';

beforeEach(() => {
 localStorage.clear(); window.history.replaceState(null, '', '/library');
 Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
 window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);
function mount() {
 const services = createDefaultServices();
 services.answering.health = vi.fn(async () => ({ ready: true, library: { document_count: 1, chunk_count: 2 }, answering: {} } as any));
 services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
 services.settings.update = vi.fn(async value => value);
 services.history.enabled = vi.fn(async () => true);
 const runtime = createAppRuntime(services, window);
 render(<AppProviders runtime={runtime}><AppShell><p>Feature content</p></AppShell></AppProviders>);
 return runtime;
}
it('renders health and refreshes through the shared service', async () => {
 const runtime = mount();
 await screen.findByText('1 document · 2 passages · local model ready');
 fireEvent.click(screen.getByText('Refresh'));
 await waitFor(() => expect(runtime.services.answering.health).toHaveBeenCalledTimes(2));
 expect(screen.getByText('Feature content')).toBeTruthy();
});
it('navigates and resets chat without activating the printed keyboard shortcut', () => {
 const runtime = mount();
 fireEvent.click(screen.getByRole('link', { name: 'New Chat' }));
 expect(runtime.navigation.getSnapshot()).toEqual({ path: '/', chatEpoch: 1 });
 fireEvent.keyDown(window, { key: 'o', ctrlKey: true, shiftKey: true });
 expect(runtime.navigation.getSnapshot().chatEpoch).toBe(1);
});
it('persists desktop collapse and restores navigation through the rail', () => {
 mount(); fireEvent.click(screen.getByRole('button', { name: 'Close Sidebar' }));
 expect(localStorage.sidebar).toBe('false');
 fireEvent.click(screen.getByRole('button', { name: 'Open Sidebar' }));
 expect(localStorage.sidebar).toBe('true');
});
it('closes mobile navigation after selecting a destination', () => {
 window.innerWidth = 390; const runtime = mount();
 fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
 fireEvent.click(screen.getByRole('link', { name: 'History' }));
 expect(runtime.navigation.getSnapshot().path).toBe('/history');
 expect(localStorage.sidebar).toBe('false');
});
it('retains the confirmed preference and shows existing error copy on save failure', async () => {
 const runtime = mount();
 await waitFor(() => expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true));
 runtime.services.settings.update = vi.fn(async () => { throw new Error('failure'); });
 fireEvent.click(screen.getByRole('switch'));
 await screen.findByRole('alert');
 expect(screen.getByRole('alert').textContent).toBe('Could not save this preference. Please retry.');
 expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
});
it('applies stored theme and closes the sidebar on entering the mobile breakpoint', () => {
 localStorage.theme = 'dark'; mount();
 expect(document.documentElement.classList.contains('dark')).toBe(true);
 window.innerWidth = 767; fireEvent(window, new Event('resize'));
 expect(screen.queryByRole('button', { name: 'Close Sidebar' })).toBeNull();
 expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
});
it('reports degraded health using the local error message', async () => {
 const runtime = mount(); await screen.findByText('1 document · 2 passages · local model ready');
 runtime.services.answering.health = vi.fn(async () => { throw new Error('Local service unavailable'); });
 fireEvent.click(screen.getByText('Refresh'));
 await screen.findByText('Workspace needs attention');
 expect(screen.getByText('Local service unavailable')).toBeTruthy();
});
it('opens with a horizontal mobile swipe and excludes input targets', async () => {
 window.innerWidth = 390; mount();
 const touch = (type: string, x: number, y: number, target: Window | Element = window) => fireEvent(target, new TouchEvent(type, { touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y } as Touch], bubbles: true, cancelable: true }));
 touch('touchstart', 25, 200, screen.getByRole('switch')); touch('touchmove', 230, 200); touch('touchend',230,200);
 expect(screen.queryByRole('button', { name: 'Close Sidebar' })).toBeNull();
 touch('touchstart',25,200);touch('touchmove',230,200);touch('touchend',230,200);
 await waitFor(() => expect(screen.getByRole('button', { name: 'Close Sidebar' })).toBeTruthy());
});
