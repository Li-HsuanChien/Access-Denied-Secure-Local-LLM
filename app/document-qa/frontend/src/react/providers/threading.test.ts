import { expect, it, vi } from 'vitest';
import { createDefaultServices } from './AppProviders';
import { createAnswering } from './answering';

it('sends a stable conversation ID and lets the host persist threaded turns', async () => {
 const services = createDefaultServices();
 services.answering.ask = vi.fn(async () => ({ request_id: 'a', warnings: [] } as any));
 services.history.save = vi.fn();
 const coordinator = createAnswering(services);
 await coordinator.ask({ sessionId: 'session', conversationId: 'room', question: 'First', generalKnowledge: true });
 await coordinator.ask({ sessionId: 'session', conversationId: 'room', question: 'Next', generalKnowledge: false });
 expect(services.answering.ask).toHaveBeenNthCalledWith(1, 'First', true, 'room');
 expect(services.answering.ask).toHaveBeenNthCalledWith(2, 'Next', false, 'room');
 expect(services.history.save).not.toHaveBeenCalled();
});

it('serializes Library document mutations and clears stale reviews on reselection', async () => {
 const { createLibrary } = await import('./library');
 const services = createDefaultServices();
 let resolve!: (value: { enabled: boolean }) => void;
 services.library.setDocumentEnabled = vi.fn(() => new Promise(yes => { resolve = yes; }));
 services.library.deleteDocument = vi.fn();
 services.library.versions = vi.fn(async () => ({ active: null, versions: [] }));
 services.library.review = vi.fn(async () => ({ review_id: 'old', accepted: [{ name: 'a.pdf', size: 1 }], rejected: [], warning: null, requires_confirmation: false }));
 const library = createLibrary(services);
 library.select([{ name: 'a.pdf', size: 1, data: 'YQ==' }]);
 await library.review();
 library.select([{ name: 'b.pdf', size: 1, data: 'Yg==' }]);
 expect(library.getSnapshot().review).toBeNull();
 const mutation = library.setDocumentEnabled('v1', 'doc', false);
 await library.deleteDocument('v1', 'doc');
 expect(services.library.deleteDocument).not.toHaveBeenCalled();
 expect(library.getSnapshot().busy).toBe(true);
 resolve({ enabled: false });
 await mutation;
 expect(services.library.setDocumentEnabled).toHaveBeenCalledWith('v1', 'doc', false);
 expect(library.getSnapshot().busy).toBe(false);
 library.dispose();
});
