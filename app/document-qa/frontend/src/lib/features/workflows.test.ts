import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryClient } from './history/historyClient';
import { createLibraryClient } from './library/libraryClient';
import { createSettingsClient } from './settings/settingsClient';

afterEach(() => vi.unstubAllGlobals());

function hostReply(operation: string, result: unknown) {
	vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
		const request = JSON.parse(String(init.body));
		return new Response(JSON.stringify({ request_id: request.request_id, operation, result }), { status: 200 });
	}));
}

describe('feature workflow clients', () => {
	it('sends selected PDF bytes through the review operation', async () => {
		hostReply('library.review', { review_id: 'review-1', accepted: [], rejected: [{ name: 'bad.pdf', reason: 'unreadable' }], warning: 'Rejected', requires_confirmation: true });
		const result = await createLibraryClient().review([{ name: 'bad.pdf', data: 'JVBERg==' }]);
		expect(result.rejected[0].reason).toBe('unreadable');
		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).operation).toBe('library.review');
	});

	it('opens saved conversations through the History interface', async () => {
		hostReply('history.open', { conversation: { collection_version: 'v2', model_id: 'm1' } });
		expect(await createHistoryClient().open('c1')).toMatchObject({ collection_version: 'v2', model_id: 'm1' });
	});

	it('persists the approved general-knowledge setting', async () => {
		hostReply('settings.update', { general_knowledge: false });
		expect(await createSettingsClient().update({ general_knowledge: false })).toEqual({ general_knowledge: false });
	});
});
