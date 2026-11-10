import type { Citation, Immutable } from '../../lib/features/react-contracts';
import { createStore } from './store';

/**
 * One request to show a PDF in the shared document viewer slot. The viewer never loads bytes on its
 * own: it calls `load()` (e.g. `() => services.answering.fetchSource(documentId, version)`) only after
 * `open()`, so a PDF loads only on an explicit "Show document page" / preview action.
 */
export interface DocumentViewerRequest {
	/** Document title (plain, untrusted text). */
	readonly title: string;
	/** Secondary line, e.g. "Page 4" or "Pages 4–5 · Used in answers". */
	readonly subtitle?: string;
	/** Page to open on; defaults to the citation's first page, then 1. */
	readonly page?: number;
	/** Citation to highlight (highlight_rects when coordinates_reliable, else text-layer match). */
	readonly citation?: Immutable<Citation>;
	/** Reads the PDF bytes. Called once per open (and again on Retry). */
	load(): Promise<ArrayBuffer>;
	/** Focus target on close. Defaults to the element focused when open() was called. */
	readonly returnFocus?: HTMLElement | null;
}
export interface OpenDocument extends DocumentViewerRequest {
	/** Increments on every open(); use as a React key to reset viewer state. */
	readonly id: number;
	readonly returnFocus: HTMLElement | null;
}
export interface DocumentViewerState { readonly current: OpenDocument | null }
export interface DocumentViewer {
	readonly current: OpenDocument | null;
	/** Shows the document, replacing any open one (viewers never stack). */
	open(request: DocumentViewerRequest): void;
	/** Hides the viewer and restores focus to `returnFocus`. */
	close(): void;
}

export function createDocumentViewer(doc: Document = document) {
	const store = createStore<DocumentViewerState>({ current: null });
	let next = 1;
	return {
		getSnapshot: store.getSnapshot,
		subscribe: store.subscribe,
		open(request: DocumentViewerRequest) {
			const previous = store.getSnapshot().current;
			const active = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;
			// Re-opening from inside the viewer keeps the original trigger as the return target.
			const inside = active?.closest('[data-document-viewer]');
			const returnFocus = request.returnFocus ?? (inside ? previous?.returnFocus ?? null : active);
			store.update(() => ({ current: { ...request, id: next++, returnFocus } }));
		},
		close() {
			const current = store.getSnapshot().current;
			if (!current) return;
			store.update(() => ({ current: null }));
			const target = current.returnFocus;
			setTimeout(() => { if (target && doc.contains(target)) target.focus({ preventScroll: true }); }, 0);
		}
	};
}
