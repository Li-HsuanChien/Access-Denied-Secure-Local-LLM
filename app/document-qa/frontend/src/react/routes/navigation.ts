import type { AppPath, NavigationOptions, RouteState } from '../../lib/features/react-contracts';
import { isLocalTemporaryChat } from '../../lib/features/answering/localChatMode';
import { createStore } from '../providers/store';

const paths = new Set<string>(['/', '/qa', '/library', '/history', '/settings']);
export function appPath(pathname: string): AppPath | null {
	return (paths.has(pathname) || /^\/conversation\/[^/]+$/.test(pathname)) ? pathname as AppPath : null;
}
export const isChatPath = (path: AppPath) => path === '/' || path === '/qa' || path.startsWith('/conversation/');

/** No upstream chat lookup or router dependency. Unknown routes settle at root. */
export function createNavigation(browser: Window) {
	function currentPath() {
  try { decodeURIComponent(browser.location.pathname); } catch { browser.history.replaceState(null, "", "/"); }
		const known = appPath(browser.location.pathname);
		if (known) return known;
		browser.history.replaceState(null, '', '/');
		return '/' as const;
	}
	const path = currentPath();
	const store = createStore<RouteState>({ path, chatEpoch: 0, temporary: isLocalTemporaryChat(new URL(browser.location.href)) });
	function transition(path: AppPath, reset = false) {
		const temporary = isLocalTemporaryChat(new URL(browser.location.href));
		store.update((s) => ({ path, temporary, chatEpoch: s.chatEpoch + ((reset || path !== s.path || temporary !== s.temporary) && isChatPath(path) ? 1 : 0) }));
	}
	const onPopState = () => transition(currentPath());
	let subscribers = 0;
	return {
		getSnapshot: store.getSnapshot,
		subscribe(listener: () => void) {
			if (subscribers++ === 0) browser.addEventListener('popstate', onPopState);
			const unsubscribe = store.subscribe(listener);
			return () => {
				unsubscribe();
				if (--subscribers === 0) browser.removeEventListener('popstate', onPopState);
			};
		},
		navigate(path: AppPath, options: NavigationOptions = {}) {
			const query = new URLSearchParams();
			if (path === '/' && options.localModel) query.set('model', 'secure-qa-local');
			if ((path === '/' || path === '/qa') && options.temporary) query.set('local-temporary', 'true');
			const destination = path + (query.size ? `?${query}` : '');
			if (options.replace) browser.history.replaceState(null, '', destination);
			else browser.history.pushState(null, '', destination);
			transition(path, options.newChat ?? path === '/');
		}
	};
}
