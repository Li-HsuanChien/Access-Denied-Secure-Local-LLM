import type { AppPath, NavigationOptions, RouteState } from '../../lib/features/react-contracts';
import { createStore } from '../providers/store';

const paths = new Set<string>(['/', '/qa', '/library', '/history', '/settings']);
export function appPath(pathname: string): AppPath | null {
	return paths.has(pathname) ? pathname as AppPath : null;
}
export const isChatPath = (path: AppPath) => path === '/' || path === '/qa';

/** No upstream chat lookup or router dependency. Unknown routes settle at root. */
export function createNavigation(browser: Window) {
	function currentPath() {
		const known = appPath(browser.location.pathname);
		if (known) return known;
		browser.history.replaceState(null, '', '/');
		return '/' as const;
	}
	const store = createStore<RouteState>({ path: currentPath(), chatEpoch: 0 });
	function transition(path: AppPath, reset = false) {
		store.update((s) => ({ path, chatEpoch: s.chatEpoch + ((reset || path !== s.path) && isChatPath(path) ? 1 : 0) }));
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
			const destination = path === '/' && options.localModel ? '/?model=secure-qa-local' : path;
			if (options.replace) browser.history.replaceState(null, '', destination);
			else browser.history.pushState(null, '', destination);
			transition(path, options.newChat ?? path === '/');
		}
	};
}
