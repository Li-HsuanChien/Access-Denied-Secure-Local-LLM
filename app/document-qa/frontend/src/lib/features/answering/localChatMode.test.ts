import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { localTemporaryChat, syncLocalChatMode } from './localChatMode';
import { createOpenWebUIAnsweringAdapter } from './openWebUIChatAdapter';

const navigate = (path: string) => syncLocalChatMode(new URL(path, 'http://127.0.0.1:5173'));
afterEach(() => localTemporaryChat.set(false));

describe('local chat privacy across navigation', () => {
    it('New Chat clears the temporary label state and restores thread persistence', async () => {
        const client = { ask: vi.fn().mockResolvedValue({}) };
        const history = { save: vi.fn() };
        const adapter = createOpenWebUIAnsweringAdapter(client as any, history);
        navigate('/?local-temporary=true');
        expect(get(localTemporaryChat)).toBe(true);
        await adapter.ask('Private question', true, 'private-thread', get(localTemporaryChat));
        expect(client.ask).toHaveBeenLastCalledWith('Private question', true, undefined);
        navigate('/');
        expect(get(localTemporaryChat)).toBe(false);
        await adapter.ask('Saved question', true, 'new-thread', get(localTemporaryChat));
        expect(client.ask).toHaveBeenLastCalledWith('Saved question', true, 'new-thread');
    });

    it('follows back/forward and excludes saved threads and non-chat routes', () => {
        for (const path of ['/c/saved', '/library', '/history', '/settings', '/qa']) {
            navigate('/?local-temporary=true');
            navigate(path);
            expect(get(localTemporaryChat)).toBe(false);
        }
        navigate('/qa?local-temporary=true');
        expect(get(localTemporaryChat)).toBe(true);
        navigate('/');
        navigate('/?local-temporary=true');
        expect(get(localTemporaryChat)).toBe(true);
        navigate('/c/saved?local-temporary=true');
        expect(get(localTemporaryChat)).toBe(false);
    });
});
