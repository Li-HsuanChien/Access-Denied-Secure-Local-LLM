import type { AppServices, LibraryState, SelectedPdf } from '../../lib/features/react-contracts';
import { createStore, errorMessage } from './store';

export function createLibrary(services: AppServices) {
	const store = createStore<LibraryState>({
		selected: [], review: null, confirmed: false, attempted: false, busy: false,
		publication: null, versions: [], notice: '', error: ''
	});
	let poll: ReturnType<typeof setTimeout> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;
	let versionRead = 0;
	let uncertainPublication = false;
	const fail = (e: unknown) => store.update((s) => ({ ...s, error: errorMessage(e, 'The local library request failed.') }));
	function stopTimers() { clearTimeout(poll); clearInterval(clock); }
	function finish(requestId: string) {
		if (store.getSnapshot().publication?.requestId !== requestId) return;
		stopTimers();
		store.update((s) => ({ ...s, busy: false, publication: null }));
	}
	async function refresh() {
		const read = ++versionRead;
		try {
			const result = await services.library.versions();
			if (read === versionRead) store.update((s) => ({ ...s, versions: result.versions }));
		} catch (e) { if (read === versionRead) fail(e); }
	}
	async function pollStatus(requestId: string) {
		if (store.getSnapshot().publication?.requestId !== requestId) return;
		try {
			const result = await services.library.status(requestId);
			if (store.getSnapshot().publication?.requestId !== requestId) return;
			if (result) {
				store.update((s) => ({ ...s, publication: s.publication && { ...s.publication,
					progress: s.publication.cancellation === 'available' ? `${result.stage} · ${result.done}/${result.total}` : s.publication.progress,
					statusError: null } }));
				// A lost POST response is not cancellation. Keep its identity until host status is terminal.
				if (uncertainPublication && ['complete', 'failed', 'cancelled'].includes(result.status)) {
					if (result.status === 'complete') store.update((s) => ({ ...s, selected: [], review: null }));
					else if (result.error) store.update((s) => ({ ...s, error: result.error! }));
					finish(requestId);
					await refresh();
					return;
				}
			}
		} catch (e) {
			if (store.getSnapshot().publication?.requestId === requestId) {
				store.update((s) => ({ ...s, publication: s.publication && {
					...s.publication, statusError: errorMessage(e, 'The local library request failed.') } }));
			}
		}
		if (store.getSnapshot().publication?.requestId === requestId) {
			poll = setTimeout(() => { void pollStatus(requestId); }, 700);
		}
	}
 async function mutateDocument(action: () => Promise<unknown>, notice: string) {
  if (store.getSnapshot().busy) return;
  versionRead += 1;
  store.update(s => ({ ...s, busy: true, error: '', notice: '' }));
  try { await action(); store.update(s => ({ ...s, notice })); }
  catch (e) { fail(e); }
  finally { await refresh(); store.update(s => ({ ...s, busy: false })); }
 }
	return {
		...store, refresh,
  setDocumentEnabled(versionId: string, documentId: string, enabled: boolean) {
   return mutateDocument(() => services.library.setDocumentEnabled(versionId, documentId, enabled), enabled ? 'PDF is on for future answers.' : 'PDF is off for future answers. Preview remains available.');
  },
  deleteDocument(versionId: string, documentId: string) {
   return mutateDocument(() => services.library.deleteDocument(versionId, documentId, true), 'PDF was deleted from the library.');
  },
		select(files: readonly SelectedPdf[]) {
			if (!store.getSnapshot().busy) store.update((s) => ({ ...s, selected: [...files], review: null, confirmed: false, attempted: false }));
		},
		confirm(value: boolean) { store.update((s) => ({ ...s, confirmed: value })); },
		async review() {
			const state = store.getSnapshot();
			if (state.busy || !state.selected.length) return;
			store.update((s) => ({ ...s, busy: true, error: '', notice: '', review: null }));
			try {
				const review = await services.library.review(state.selected.map(({ name, data }) => ({ name, data })));
				store.update((s) => ({ ...s, review, confirmed: false, attempted: false }));
			} catch (e) { fail(e); }
			finally { store.update((s) => ({ ...s, busy: false })); }
		},
		async publish() {
			const state = store.getSnapshot();
			if (state.busy || !state.review?.accepted.length || (state.review.rejected.length > 0 && !state.confirmed)) return;
			const requestId = services.createId(), startedAt = services.now();
			uncertainPublication = false;
			store.update((s) => ({ ...s, busy: true, attempted: true, error: '', notice: '',
				publication: { requestId, startedAt, progress: 'Preparing accepted PDFs…', elapsedSeconds: 0,
					cancellation: 'available', statusError: null } }));
			clock = setInterval(() => store.update((s) => ({ ...s, publication: s.publication && {
				...s.publication, elapsedSeconds: Math.floor((services.now() - startedAt) / 1000) } })), 1000);
			poll = setTimeout(() => { void pollStatus(requestId); }, 700);
			try {
				const result = await services.library.publish(state.review.review_id, state.confirmed, requestId);
				store.update((s) => ({ ...s, review: null, selected: [],
					notice: `Library updated · ${result.document_count} PDFs · ${result.chunk_count} passages.` }));
				finish(requestId);
				await refresh();
			} catch (e) {
				fail(e);
				const code = (e as { code?: string } | null)?.code;
				uncertainPublication = code === 'unreachable' || code === 'invalid_response' || e instanceof TypeError || e instanceof SyntaxError;
				if (!uncertainPublication) finish(requestId);
			}
		},
		async cancel() {
			const publication = store.getSnapshot().publication;
			if (!publication || publication.cancellation !== 'available') return;
			const requestId = publication.requestId;
			store.update((s) => ({ ...s, publication: s.publication && {
				...s.publication, cancellation: 'requested', progress: 'Cancelling safely…' } }));
			try {
				const accepted = await services.library.cancel(requestId);
				if (store.getSnapshot().publication?.requestId !== requestId) return;
				if (!accepted) store.update((s) => ({ ...s, publication: s.publication && {
					...s.publication, cancellation: 'unavailable', progress: 'Publication is finishing; cancellation is no longer available.' } }));
			} catch (e) {
				if (store.getSnapshot().publication?.requestId !== requestId) return;
				fail(e);
				store.update((s) => ({ ...s, publication: s.publication && { ...s.publication, cancellation: 'available' } }));
			}
		},
		async rollback() {
			if (store.getSnapshot().busy) return;
			store.update((s) => ({ ...s, busy: true, error: '' }));
			try {
				const result = await services.library.rollback();
				store.update((s) => ({ ...s, notice: `Collection ${result.version_id} is active again.` }));
				await refresh();
			} catch (e) { fail(e); }
			finally { store.update((s) => ({ ...s, busy: false })); }
		},
		leave() {
			if (store.getSnapshot().busy) return;
			store.update((s) => ({ ...s, selected: [], review: null, confirmed: false, attempted: false, notice: '', error: '' }));
		},
		/** Test/app teardown only. Route unmount MUST NOT call this. */
		dispose: stopTimers
	};
}
