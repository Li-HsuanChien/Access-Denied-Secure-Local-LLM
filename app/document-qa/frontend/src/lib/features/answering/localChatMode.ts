import { writable } from 'svelte/store';

// Product privacy state, independent of Open WebUI's upstream storage bypass.
export const localTemporaryChat = writable(false);

/** Reconcile privacy on every navigation, including New Chat and back/forward. */
export function syncLocalChatMode(url: URL) {
    localTemporaryChat.set(
        (url.pathname === '/' || url.pathname === '/qa') &&
        url.searchParams.get('local-temporary') === 'true'
    );
}
