import { expect, it } from 'vitest';
import { createNavigation } from './navigation';

it('redirects unsupported saved-chat URLs without an upstream API lookup', () => {
	window.history.replaceState(null, '', '/c/old');
	const navigation = createNavigation(window);
	expect(navigation.getSnapshot().path).toBe('/');
	expect(window.location.pathname).toBe('/');
});
it('resets root chat on New Chat and remounts chat after Back', () => {
	window.history.replaceState(null, '', '/qa');
	const navigation = createNavigation(window);
	const unsubscribe = navigation.subscribe(() => undefined);
	navigation.navigate('/', { newChat: true });
	const firstEpoch = navigation.getSnapshot().chatEpoch;
	navigation.navigate('/', { newChat: true });
	expect(navigation.getSnapshot().chatEpoch).toBe(firstEpoch + 1);
	navigation.navigate('/history');
	window.history.replaceState(null, '', '/');
	window.dispatchEvent(new PopStateEvent('popstate'));
	expect(navigation.getSnapshot().chatEpoch).toBe(firstEpoch + 2);
	unsubscribe();
});
it('opens a fresh local-model chat with the original query and clears it on ordinary navigation', () => {
	window.history.replaceState(null, '', '/library');
	const navigation = createNavigation(window);
	navigation.navigate('/', { newChat: true, localModel: true });
	expect(window.location.pathname + window.location.search).toBe('/?model=secure-qa-local');
	expect(navigation.getSnapshot()).toEqual({ path: '/', chatEpoch: 1 });
	navigation.navigate('/', { newChat: true, localModel: true });
	expect(navigation.getSnapshot().chatEpoch).toBe(2);
	navigation.navigate('/history');
	expect(window.location.search).toBe('');
	navigation.navigate('/library', { localModel: true });
	expect(window.location.pathname + window.location.search).toBe('/library');
});
it('preserves direct conversation routes and remounts when selecting another thread', () => {
 window.history.replaceState(null, '', '/conversation/room-1');
 const navigation = createNavigation(window);
 expect(navigation.getSnapshot().path).toBe('/conversation/room-1');
 navigation.navigate('/conversation/room-2');
 expect(navigation.getSnapshot().chatEpoch).toBe(1);
 expect(window.location.pathname).toBe('/conversation/room-2');
});
