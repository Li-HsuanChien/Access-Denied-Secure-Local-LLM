import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Answer, AppServices } from '../../lib/features/react-contracts';
import { createPreferences } from './preferences';
import { createAnswering } from './answering';
import { createLibrary } from './library';
import { ClientError } from '../../lib/features/answering/answeringClient';

function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const answer: Answer = {
	schema_version: '1.0.0', request_id: 'answer-1', question: 'question', status: 'insufficient_evidence',
	evidence_mode: 'none', documents: [], citations: [], evidence: [], general_knowledge: null,
	limitations: [], warnings: [], model: null, collection_version: null, prompt_version: 'test',
	timing: { retrieval_ms: 0, generation_ms: 0, total_ms: 0, attempts: 1, prompt_tokens: null, completion_tokens: null },
	error: null
};
function services(): AppServices {
	return {
		createId: () => 'publication-1', now: () => Date.now(),
		answering: { fetchSource: vi.fn(), health: vi.fn(), ask: vi.fn(async () => answer) },
		settings: { read: vi.fn(async () => ({ general_knowledge: true })), update: vi.fn(async (v) => v) },
		history: {
			list: vi.fn(async () => []), open: vi.fn(async () => null), save: vi.fn(async () => true),
			remove: vi.fn(async () => true), clear: vi.fn(async () => undefined),
			enabled: vi.fn(async () => true), setEnabled: vi.fn(async (v) => v)
		},
		library: {
			setDocumentEnabled: vi.fn(), deleteDocument: vi.fn(), review: vi.fn(async () => ({ review_id: 'review-1', accepted: [{ name: 'a.pdf', size: 10 }],
				rejected: [], warning: null, requires_confirmation: false })),
			publish: vi.fn(), status: vi.fn(async () => ({ status: 'running', stage: 'indexing', done: 1, total: 2 })),
			cancel: vi.fn(async () => true), versions: vi.fn(async () => ({ active: null, versions: [] })),
			rollback: vi.fn(async () => ({ version_id: 'previous' }))
		}
	};
}
afterEach(() => { vi.useRealTimers(); });

describe('shared preferences', () => {
	it('skips refresh reads during queued writes and lets only the newest later read commit', async () => {
		const deps = services(), write = deferred<{ general_knowledge: boolean }>();
		deps.settings.update = vi.fn(() => write.promise);
		const preferences = createPreferences(deps);
		const saving = preferences.setGeneralKnowledge(false);
		await preferences.refresh();
		expect(deps.settings.read).not.toHaveBeenCalled();
		write.resolve({ general_knowledge: false }); await saving;
		const oldRead = deferred<{ general_knowledge: boolean }>(), newestRead = deferred<{ general_knowledge: boolean }>();
		deps.settings.read = vi.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newestRead.promise);
		const old = preferences.refresh(), newest = preferences.refresh();
		newestRead.resolve({ general_knowledge: false }); await newest;
		oldRead.resolve({ general_knowledge: true }); await old;
		expect(preferences.getSnapshot().generalKnowledge).toBe(false);
	});
	it('returns settled refresh errors on repeated failures and clears them on recovery', async () => {
		const deps = services();
		deps.settings.read = vi.fn()
			.mockRejectedValueOnce(new Error('settings unavailable'))
			.mockRejectedValueOnce(new Error('settings unavailable'))
			.mockResolvedValueOnce({ general_knowledge: false });
		const preferences = createPreferences(deps);
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await preferences.refresh();
			expect(result).toBe(preferences.getSnapshot());
			expect(result?.errors.generalKnowledge).toBe('settings unavailable');
		}
		const recovered = await preferences.refresh();
		expect(recovered?.errors.generalKnowledge).toBeNull();
		expect(recovered?.generalKnowledge).toBe(false);
	});
	it('does not let an old initial read overwrite a successful write', async () => {
		const deps = services(), initial = deferred<{ general_knowledge: boolean }>();
		deps.settings.read = () => initial.promise;
		const preferences = createPreferences(deps);
		const read = preferences.refresh();
		await preferences.setGeneralKnowledge(false);
		initial.resolve({ general_knowledge: true });
		await read;
		expect(preferences.getSnapshot().generalKnowledge).toBe(false);
	});
	it('serializes writes and retains committed state on failure', async () => {
		const deps = services(), first = deferred<{ general_knowledge: boolean }>();
		deps.settings.update = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('save failed'));
		const preferences = createPreferences(deps);
		const a = preferences.setGeneralKnowledge(false), b = preferences.setGeneralKnowledge(true);
		const rejected = expect(b).rejects.toThrow('save failed');
		await Promise.resolve();
		expect(deps.settings.update).toHaveBeenCalledTimes(1);
		expect(preferences.getSnapshot().generalKnowledge).toBe(true);
		first.resolve({ general_knowledge: false });
		await a; await rejected;
		expect(preferences.getSnapshot().generalKnowledge).toBe(false);
		expect(preferences.getSnapshot().pending.generalKnowledge).toBe(0);
		expect(preferences.getSnapshot().errors.generalKnowledge).toBe('save failed');
	});
});
describe('app lifetime answering', () => {
	it('blocks a new session until the old answer and single save settle', async () => {
		const deps = services(), response = deferred<Answer>(), saved = deferred<boolean>();
		deps.answering.ask = vi.fn(() => response.promise);
		deps.history.save = vi.fn(() => saved.promise);
		const answering = createAnswering(deps);
		const first = answering.ask({ sessionId: 'old', question: 'first', generalKnowledge: true });
		await expect(answering.ask({ sessionId: 'new', question: 'second', generalKnowledge: false })).rejects.toThrow('Another question');
		response.resolve(answer);
		await vi.waitFor(() => expect(deps.history.save).toHaveBeenCalledTimes(1));
		expect(answering.getSnapshot().pending?.sessionId).toBe('old');
		saved.resolve(true);
		const result = await first;
		expect(answering.getSnapshot().pending).toBeNull();
		expect(Object.isFrozen(result.answer)).toBe(true);
		expect(Object.isFrozen(result.answer.timing)).toBe(true);
		expect(deps.answering.ask).toHaveBeenCalledTimes(1);
	});
	it('keeps validated answer available after history failure', async () => {
		const deps = services();
		deps.history.save = vi.fn(async () => { throw new Error('disk'); });
		const result = await createAnswering(deps).ask({ sessionId: 'a', question: 'question', generalKnowledge: false });
		expect(result.answer).toEqual(answer);
		expect(result.historyWarning).toContain('could not be saved');
	});
});
describe('app lifetime library', () => {
	it('rejects publication without accepted files and without required rejection confirmation', async () => {
		const deps = services(), library = createLibrary(deps);
		await library.publish(); expect(deps.library.publish).not.toHaveBeenCalled();
		deps.library.review = vi.fn(async () => ({ review_id: 'review', accepted: [], rejected: [{ name: 'bad.pdf', reason: 'invalid' }], warning: 'rejected', requires_confirmation: true }));
		library.select([{ name: 'bad.pdf', data: 'YQ==', size: 1 }]); await library.review(); library.confirm(true);
		await library.publish(); expect(deps.library.publish).not.toHaveBeenCalled();
		deps.library.review = vi.fn(async () => ({ review_id: 'review', accepted: [{ name: 'good.pdf', size: 1 }], rejected: [{ name: 'bad.pdf', reason: 'invalid' }], warning: 'rejected', requires_confirmation: true }));
		await library.review(); await library.publish(); expect(deps.library.publish).not.toHaveBeenCalled();
		library.dispose();
	});
	it('does not overlap slow status polls or apply old status/cancel responses to a new publication', async () => {
		vi.useFakeTimers();
		const deps = services(), firstPost = deferred<{ version_id: string; document_count: number; chunk_count: number }>(), secondPost = deferred<{ version_id: string; document_count: number; chunk_count: number }>();
		const status = deferred<{ status: string; stage: string; done: number; total: number }>(), cancellation = deferred<boolean>();
		let id = 0; Object.assign(deps, { createId: () => `publication-${++id}` });
		deps.library.publish = vi.fn().mockReturnValueOnce(firstPost.promise).mockReturnValueOnce(secondPost.promise);
		deps.library.status = vi.fn(() => status.promise); deps.library.cancel = vi.fn(() => cancellation.promise);
		const library = createLibrary(deps), selected = [{ name: 'a.pdf', data: 'YQ==', size: 10 }];
		library.select(selected); await library.review(); const first = library.publish();
		await vi.advanceTimersByTimeAsync(4_000); expect(deps.library.status).toHaveBeenCalledTimes(1);
		const cancel = library.cancel();
		firstPost.resolve({ version_id: 'v1', document_count: 1, chunk_count: 2 }); await first;
		library.select(selected); await library.review(); const second = library.publish();
		expect(library.getSnapshot().publication?.requestId).toBe('publication-2');
		status.resolve({ status: 'running', stage: 'old job', done: 9, total: 10 }); cancellation.resolve(false);
		await cancel; await Promise.resolve();
		expect(library.getSnapshot().publication?.progress).toBe('Preparing accepted PDFs…');
		expect(library.getSnapshot().publication?.cancellation).toBe('available');
		expect(deps.library.cancel).toHaveBeenCalledWith('publication-1');
		secondPost.resolve({ version_id: 'v2', document_count: 1, chunk_count: 2 }); await second; library.dispose();
	});
	it('retains uncertain publication identity after null/error status and ends only on a terminal outcome', async () => {
		vi.useFakeTimers();
		const deps = services();
		deps.library.publish = vi.fn(async () => { throw new ClientError('invalid_response', 'lost result'); });
		deps.library.status = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('status lost')).mockResolvedValueOnce({ status: 'failed', stage: 'indexing', done: 1, total: 2, error: 'Build failed safely' });
		const library = createLibrary(deps);
		library.select([{ name: 'a.pdf', data: 'YQ==', size: 10 }]); await library.review(); await library.publish();
		for (let poll = 0; poll < 2; poll++) {
			await vi.advanceTimersByTimeAsync(701); library.leave();
			expect(library.getSnapshot().busy).toBe(true);
			expect(library.getSnapshot().publication?.requestId).toBe('publication-1');
		}
		expect(library.getSnapshot().publication?.statusError).toBe('status lost');
		await vi.advanceTimersByTimeAsync(701);
		expect(library.getSnapshot().busy).toBe(false); expect(library.getSnapshot().publication).toBeNull();
		expect(library.getSnapshot().review?.review_id).toBe('review-1');
		expect(library.getSnapshot().attempted).toBe(true); expect(library.getSnapshot().error).toBe('Build failed safely');
		library.dispose();
	});
	it('keeps publication identity across route exit and cancellation until host settles', async () => {
		vi.useFakeTimers();
		const deps = services(), response = deferred<{ version_id: string; document_count: number; chunk_count: number }>();
		deps.library.publish = vi.fn(() => response.promise);
		const library = createLibrary(deps);
		library.select([{ name: 'a.pdf', data: 'YQ==', size: 10 }]); await library.review();
		const publication = library.publish();
		library.leave();
		await vi.advanceTimersByTimeAsync(701);
		expect(deps.library.status).toHaveBeenCalledWith('publication-1');
		await library.cancel();
		expect(library.getSnapshot().busy).toBe(true);
		expect(library.getSnapshot().publication?.cancellation).toBe('requested');
		await library.publish();
		expect(deps.library.publish).toHaveBeenCalledTimes(1);
		response.resolve({ version_id: 'v1', document_count: 1, chunk_count: 2 });
		await publication;
		expect(library.getSnapshot().publication).toBeNull();
		expect(library.getSnapshot().notice).toContain('Library updated');
		library.dispose();
	});
	it('retains a lost publication response until terminal polling confirms outcome', async () => {
		vi.useFakeTimers();
		const deps = services();
		deps.library.publish = vi.fn(async () => { throw new ClientError('unreachable', 'connection lost'); });
		const library = createLibrary(deps);
		library.select([{ name: 'a.pdf', data: 'YQ==', size: 10 }]); await library.review();
		await library.publish();
		expect(library.getSnapshot().publication?.requestId).toBe('publication-1');
		deps.library.status = vi.fn(async () => ({ status: 'cancelled', stage: 'extracting', done: 0, total: 1 }));
		await vi.advanceTimersByTimeAsync(701);
		expect(library.getSnapshot().busy).toBe(false);
		library.dispose();
	});
});
