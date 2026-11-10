import { afterEach, expect, it, vi } from 'vitest';
import type { AppServices } from '../../lib/features/react-contracts';
import { createDocumentViewer } from './documentViewer';
import { createHealth } from './health';

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

it('document viewer opens without loading, replaces instead of stacking, and returns focus to the trigger', () => {
	vi.useFakeTimers();
	const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
	const viewer = createDocumentViewer(document);
	const load = vi.fn(async () => new ArrayBuffer(1));
	viewer.open({ title: 'Handbook', load });
	expect(load).not.toHaveBeenCalled();
	const first = viewer.getSnapshot().current!;
	expect(first.returnFocus).toBe(trigger);
	// A second open from inside the viewer keeps the original return target.
	const inside = document.createElement('div'); inside.setAttribute('data-document-viewer', 'side');
	const next = document.createElement('button'); inside.append(next); document.body.append(inside); next.focus();
	viewer.open({ title: 'Handbook', page: 5, load });
	const second = viewer.getSnapshot().current!;
	expect(second.id).toBeGreaterThan(first.id);
	expect(second.returnFocus).toBe(trigger);
	viewer.close();
	expect(viewer.getSnapshot().current).toBeNull();
	vi.runAllTimers();
	expect(document.activeElement).toBe(trigger);
});

it('health readiness distinguishes ready, needs-documents and unavailable', async () => {
	const health = vi.fn();
	const store = createHealth({ answering: { health } } as unknown as AppServices);
	expect(store.getSnapshot().readiness).toBe('checking');
	health.mockResolvedValueOnce({ ready: true, answering: { ready: true }, library: { document_count: 2, chunk_count: 9 } });
	expect((await store.refresh()).readiness).toBe('ready');
	health.mockResolvedValueOnce({ ready: false, answering: { ready: true }, library: { document_count: 0, chunk_count: 0 } });
	expect((await store.refresh()).readiness).toBe('needs-documents');
	health.mockResolvedValueOnce({ ready: false, answering: { ready: false, error: { code: 'x', message: 'Model failed to load.', hint: '' } }, library: { document_count: 0, chunk_count: 0 } });
	expect(await store.refresh()).toMatchObject({ readiness: 'unavailable', message: 'Model failed to load.' });
	health.mockRejectedValueOnce(new Error('Local service unavailable'));
	expect(await store.refresh()).toMatchObject({ readiness: 'unavailable', message: 'Local service unavailable', refreshing: false });
});
