/*
 * Library view in the reading-room design (ported from prototypes/ui-revamp/src/features/library/LibraryView.tsx).
 * It renders only what the existing Library coordinator exposes: review, confirmation, publication progress
 * text, elapsed time and cancellation availability. No invented phases, counts or rollback controls.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { useDocumentViewer, useLibrary, useNavigation, useServices } from '../../../../react/providers';
import type { LibraryState, SelectedPdf } from '../../react-contracts';
import {
	Button, ConfirmDialog, IconAlert, IconButton, IconCheck, IconEye, IconFile, IconMore, IconSearch, IconTrash,
	IconUpload, IconX, Menu, Spinner, Switch, VisuallyHidden, formatBytes, useToast
} from '../../design-system/react';
import './LibraryPage.css';

type LibraryDocument = LibraryState['versions'][number]['documents'][number];
type Phase = 'checking' | 'staged' | 'ready' | 'publishing' | 'failed' | 'cancelled' | 'done';

/** Prefix of the coordinator's success notice after a publication completes. */
const PUBLISHED_NOTICE = 'Library updated ·';

function message(error: unknown) {
	return error instanceof Error ? error.message : 'The local library request failed.';
}

function encode(file: File): Promise<SelectedPdf> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error);
		reader.onload = () => resolve({ name: file.name, size: file.size, data: String(reader.result).split(',')[1] ?? '' });
		reader.readAsDataURL(file);
	});
}

function plural(count: number, one: string, many: string) {
	return `${count} ${count === 1 ? one : many}`;
}

function documentTitle(doc: LibraryDocument) {
	return doc.display_title || doc.source_filename || 'PDF document';
}

function elapsedLabel(seconds: number) {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function LibraryPage() {
	const library = useLibrary();
	const { state } = library;
	const services = useServices();
	const viewer = useDocumentViewer();
	const toast = useToast();
	const { route } = useNavigation();

	const picker = useRef<HTMLInputElement>(null);
	const addButton = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const generation = useRef(0);
	const mounted = useRef(false);
	const pendingRead = useRef<Promise<SelectedPdf[]> | null>(null);
	const deferredSelection = useRef<{ generation: number; files: SelectedPdf[] } | null>(null);
	const previousNotice = useRef(state.notice);
	const libraryState = useRef(state);
	libraryState.current = state;

	const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
	const [checking, setChecking] = useState(false);
	const [fileError, setFileError] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [filter, setFilter] = useState('');
	const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
	const [pendingDelete, setPendingDelete] = useState<{ version: string; id: string; title: string } | null>(null);
	const [pendingToggle, setPendingToggle] = useState<string | null>(null);
	const [doneVisible, setDoneVisible] = useState(() => state.notice.startsWith(PUBLISHED_NOTICE));
	const [cancelRequested, setCancelRequested] = useState(false);

	const { review, publication, selected } = state;
	const active = state.versions.find(version => version.status === 'active');
	const docs = active?.documents ?? [];
	const enabledDocs = docs.filter(doc => doc.enabled !== false);
	const enabledPages = enabledDocs.reduce((sum, doc) => sum + (doc.page_count ?? 0), 0);
	const shown = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		return needle ? docs.filter(doc => `${documentTitle(doc)} ${doc.source_filename ?? ''}`.toLowerCase().includes(needle)) : docs;
	}, [docs, filter]);

	useEffect(() => {
		mounted.current = true;
		document.title = 'Library · Access Denied';
		void library.refresh().then(() => { if (mounted.current) setLoaded(true); });
		return () => {
			mounted.current = false;
			generation.current += 1;
			const currentGeneration = generation.current;
			queueMicrotask(() => {
				if (!mounted.current && generation.current === currentGeneration) library.leave();
			});
		};
	}, [library.refresh, library.leave]);

	useEffect(() => {
		const notice = state.notice;
		if (notice !== previousNotice.current && notice) {
			if (notice.startsWith(PUBLISHED_NOTICE)) {
				generation.current += 1;
				pendingRead.current = null;
				deferredSelection.current = null;
				if (picker.current) picker.current.value = '';
				setPendingFiles(null);
				setDoneVisible(true);
			} else toast({ tone: 'success', text: notice });
		}
		previousNotice.current = notice;
		if (!state.busy && deferredSelection.current) {
			const deferred = deferredSelection.current;
			deferredSelection.current = null;
			if (deferred.generation === generation.current) {
				library.select(deferred.files);
				setPendingFiles(null);
			}
		}
	}, [state.busy, state.notice, library.select, toast]);

	useEffect(() => {
		if (route.path !== '/library') library.leave();
	}, [route.path, library.leave]);

	// Cancellation is only "requested" until the host settles; a publication that then ends without the
	// success notice was cancelled. Observing the coordinator (not the click) survives remounts.
	useEffect(() => {
		if (publication) setCancelRequested(publication.cancellation === 'requested');
	}, [publication?.requestId, publication?.cancellation]);

	let phase: Phase | null = null;
	if (publication) phase = 'publishing';
	else if (checking || pendingFiles) phase = 'checking';
	else if (review) phase = state.attempted && cancelRequested ? 'cancelled' : state.attempted && state.error ? 'failed' : 'ready';
	else if (selected.length) phase = 'staged';
	else if (doneVisible && state.notice.startsWith(PUBLISHED_NOTICE)) phase = 'done';

	const previousPhase = useRef(phase);
	useEffect(() => {
		if (phase !== previousPhase.current && (phase === 'ready' || phase === 'failed' || phase === 'cancelled' || phase === 'done' || phase === 'staged')) {
			heading.current?.focus({ preventScroll: false });
		}
		previousPhase.current = phase;
	}, [phase]);

	function resetLocalSelection() {
		generation.current += 1;
		pendingRead.current = null;
		deferredSelection.current = null;
		if (picker.current) picker.current.value = '';
		setPendingFiles(null);
		setChecking(false);
	}

	function pick(files: File[]) {
		if (!files.length) return;
		const selection = ++generation.current;
		setPendingFiles(files);
		setFileError('');
		setDoneVisible(false);
		setChecking(true);
		library.select([]);
		const read = Promise.all(files.map(encode));
		pendingRead.current = read;
		void read.then(async (encoded) => {
			if (!mounted.current || generation.current !== selection) return;
			if (libraryState.current.busy) {
				// A publication is running: keep the choice local until the coordinator is free.
				deferredSelection.current = { generation: selection, files: encoded };
				return;
			}
			library.select(encoded);
			setPendingFiles(null);
			await library.review();
		}).catch((error: unknown) => {
			if (mounted.current && generation.current === selection) {
				setFileError(message(error));
				setPendingFiles(null);
			}
		}).finally(() => {
			if (mounted.current && generation.current === selection) setChecking(false);
		});
	}

	function selectFiles(event: ChangeEvent<HTMLInputElement>) {
		pick(Array.from(event.currentTarget.files ?? []));
	}

	async function checkSelected() {
		const selection = generation.current;
		setChecking(true);
		try { await library.review(); }
		finally { if (mounted.current && generation.current === selection) setChecking(false); }
	}

	function discard() {
		resetLocalSelection();
		setDoneVisible(false);
		setFileError('');
		library.leave();
	}

	function hasFiles(event: DragEvent) {
		return Array.from(event.dataTransfer?.types ?? []).includes('Files');
	}
	function onDragOver(event: DragEvent<HTMLDivElement>) {
		if (!hasFiles(event)) return;
		// Always claim the drop so the webview never navigates to a dropped file.
		event.preventDefault();
		if (state.busy) { event.dataTransfer.dropEffect = 'none'; return; }
		event.dataTransfer.dropEffect = 'copy';
		setDragging(true);
	}
	function onDragLeave(event: DragEvent<HTMLDivElement>) {
		const next = event.relatedTarget as Node | null;
		if (!next || !event.currentTarget.contains(next)) setDragging(false);
	}
	function onDrop(event: DragEvent<HTMLDivElement>) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		setDragging(false);
		if (!state.busy) pick(Array.from(event.dataTransfer.files));
	}

	function previewDocument(doc: LibraryDocument, anchor: HTMLElement | null) {
		if (!active) return;
		const version = active.version_id;
		const title = documentTitle(doc);
		const filename = doc.source_filename && doc.source_filename !== title ? `${doc.source_filename} · ` : '';
		viewer.open({
			title,
			subtitle: `${filename}${doc.enabled !== false ? 'Used in answers' : 'Not used in answers'}`,
			page: 1,
			load: () => services.answering.fetchSource(doc.document_id, version),
			returnFocus: anchor
		});
	}

	function previewSelected(name: string, size: number, anchor: HTMLElement) {
		const file = selected.find(candidate => candidate.name === name);
		if (!file) return;
		viewer.open({
			title: name,
			subtitle: `${formatBytes(size)} · not in your library yet`,
			page: 1,
			load: async () => Uint8Array.from(atob(file.data), c => c.charCodeAt(0)).buffer,
			returnFocus: anchor
		});
	}

	async function toggle(doc: LibraryDocument, next: boolean) {
		if (!active || state.busy) return;
		setPendingToggle(doc.document_id);
		try { await library.setDocumentEnabled(active.version_id, doc.document_id, next); }
		finally { if (mounted.current) setPendingToggle(null); }
	}

	const menuDoc = menu ? docs.find(doc => doc.document_id === menu.id) : undefined;
	const error = fileError || state.error;
	// 'cancelled' only means a cancel was requested before the publication ended; the coordinator's own
	// error (cancellation or a real failure) is always shown rather than inferred away.
	const errorInTray = phase === 'staged' || phase === 'failed' || phase === 'cancelled';

	const accepted = review?.accepted ?? [];
	const rejected = review?.rejected ?? [];
	const needsConfirm = rejected.length > 0 && accepted.length > 0;
	const canPublish = !state.busy && accepted.length > 0 && (rejected.length === 0 || state.confirmed);
	const checkingNames = pendingFiles?.map(file => file.name) ?? selected.map(file => file.name);

	const titles: Record<Phase, string> = {
		checking: `Checking ${plural(checkingNames.length, 'file', 'files')}…`,
		staged: `${plural(selected.length, 'file', 'files')} selected`,
		ready: rejected.length
			? `${accepted.length} of ${accepted.length + rejected.length} files can be added`
			: `${plural(accepted.length, 'file is', 'files are')} ready to add`,
		publishing: `Adding ${plural(accepted.length, 'document', 'documents')}`,
		failed: 'These files weren’t added',
		cancelled: 'Adding stopped',
		done: 'Your library was updated'
	};
	const announcement = phase === 'checking' || phase === 'ready' || phase === 'staged' ? titles[phase]
		: phase === 'cancelled' ? `Adding stopped. ${error ? `${error} ` : ''}Your library hasn’t changed.`
		: phase === 'done' ? state.notice : '';

	const reviewRows: ReactNode = (
		<ul className="lib-review-list">
			{accepted.map(file => {
				const previewable = selected.some(candidate => candidate.name === file.name);
				return (
					<li key={`a-${file.name}`} className="lib-review-row" data-status="accepted">
						<span className="lib-review-icon" aria-hidden="true"><IconCheck size={16} /></span>
						<div className="lib-review-main">
							<p className="lib-review-name">{file.name}</p>
							<p className="lib-review-meta">{formatBytes(file.size)}</p>
						</div>
						{previewable && phase !== 'publishing' && (
							<Button size="sm" variant="ghost" icon={<IconEye size={15} />} aria-label={`Preview ${file.name}`} onClick={event => previewSelected(file.name, file.size, event.currentTarget)}>Preview</Button>
						)}
					</li>
				);
			})}
			{rejected.map((file, index) => (
				<li key={`r-${file.name}-${index}`} className="lib-review-row" data-status="rejected">
					<span className="lib-review-icon" aria-hidden="true"><IconX size={16} /></span>
					<div className="lib-review-main">
						<p className="lib-review-name">{file.name}</p>
						<p className="lib-review-meta"><VisuallyHidden>Can’t be added: </VisuallyHidden>{file.reason}</p>
					</div>
				</li>
			))}
		</ul>
	);

	return (
		<div className="lib-page library-page" aria-labelledby="library-title" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
			<header className="lib-head">
				<div>
					<h1 id="library-title" className="lib-title">Library</h1>
					<p className="lib-sub">
						{docs.length
							? <>{enabledDocs.length} of {plural(docs.length, 'document is', 'documents are')} used for answers{enabledPages > 0 && <> · {plural(enabledPages, 'page', 'pages')}</>}</>
							: 'PDFs you add here become the evidence for every answer.'}
					</p>
				</div>
				<div className="lib-actions">
					<Button ref={addButton} variant="primary" icon={<IconUpload size={16} />} onClick={() => picker.current?.click()} disabled={state.busy}>Add PDFs</Button>
					<input ref={picker} id="pdfs" type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Choose PDF files" disabled={state.busy} onChange={selectFiles} />
				</div>
			</header>

			<VisuallyHidden><span role="status" aria-live="polite">{announcement}</span></VisuallyHidden>

			{error && !errorInTray && (
				<p className="ui-callout ui-callout-error" role="alert">
					<IconAlert size={16} />
					<span className="lib-error-text">{error}</span>
					{!fileError && <button type="button" className="ui-link-btn" disabled={state.busy} onClick={() => void library.refresh()}>Check again</button>}
				</p>
			)}

			{phase && phase !== 'done' && (
				<section className="lib-review" data-phase={phase} aria-labelledby="review-title" aria-busy={phase === 'checking' || undefined}>
					<div className="lib-review-head">
						<div>
							<p className="ui-eyebrow lib-review-eyebrow">Waiting for your review · not used in answers yet</p>
							<h2 id="review-title" ref={heading} tabIndex={-1} className="lib-section-title">{titles[phase]}</h2>
						</div>
						{(phase === 'ready' || phase === 'staged' || phase === 'failed' || phase === 'cancelled') && (
							<IconButton size="sm" label="Discard this review" icon={<IconX size={16} />} onClick={discard} />
						)}
					</div>

					{phase === 'checking' && (
						<ul className="lib-review-list">
							{checkingNames.map((name, index) => (
								<li key={`${name}-${index}`} className="lib-review-row" data-status="checking">
									<span className="lib-review-icon" aria-hidden="true"><Spinner size={16} /></span>
									<div className="lib-review-main"><p className="lib-review-name">{name}</p><p className="lib-review-meta">Checking…</p></div>
								</li>
							))}
						</ul>
					)}

					{phase === 'staged' && (
						<>
							<ul className="lib-review-list">
								{selected.map((file, index) => (
									<li key={`${file.name}-${index}`} className="lib-review-row" data-status="staged">
										<span className="lib-review-icon" aria-hidden="true"><IconFile size={16} /></span>
										<div className="lib-review-main"><p className="lib-review-name">{file.name}</p><p className="lib-review-meta">{formatBytes(file.size)} · not checked yet</p></div>
									</li>
								))}
							</ul>
							{error && <p className="ui-callout ui-callout-error" role="alert"><IconAlert size={16} /><span className="lib-error-text">{error}</span></p>}
							<div className="lib-review-buttons">
								<Button variant="ghost" onClick={discard}>Discard</Button>
								<Button variant="primary" disabled={state.busy} onClick={() => void checkSelected()}>Check {plural(selected.length, 'file', 'files')}</Button>
							</div>
						</>
					)}

					{phase === 'publishing' && publication && (
						<div className="lib-progress-block">
							<div className="lib-progress" aria-hidden="true"><span /></div>
							<p className="lib-progress-step" role="status" aria-live="polite">{publication.progress}</p>
							<p className="lib-progress-meta">{elapsedLabel(publication.elapsedSeconds)} elapsed</p>
							{publication.statusError && <p className="lib-progress-note">Progress is temporarily unavailable: {publication.statusError}</p>}
							<p className="lib-progress-note">You can leave this page while this runs.</p>
							{publication.cancellation !== 'unavailable' && (
								<Button variant="secondary" size="sm" disabled={publication.cancellation !== 'available'} onClick={() => { heading.current?.focus(); void library.cancel(); }}>Cancel</Button>
							)}
						</div>
					)}

					{(phase === 'ready' || phase === 'failed' || phase === 'cancelled') && reviewRows}

					{phase === 'ready' && (
						<div className="lib-review-foot">
							{review?.warning && <p className="ui-callout ui-callout-warn"><IconAlert size={16} /><span>{review.warning}</span></p>}
							{needsConfirm && (
								<label className="ui-check">
									<input type="checkbox" checked={state.confirmed} onChange={event => library.confirm(event.currentTarget.checked)} />
									<span>Add the {plural(accepted.length, 'file that passed', 'files that passed')} and skip {rejected.length} that can’t be added</span>
								</label>
							)}
							{accepted.length === 0 && <p className="lib-review-none">None of these files can be added. Fix the issues above, then try again.</p>}
							<div className="lib-review-buttons">
								<Button variant="ghost" onClick={discard}>Cancel</Button>
								<Button variant="primary" disabled={!canPublish} onClick={() => void library.publish()}>Add {plural(accepted.length, 'document', 'documents')}</Button>
							</div>
						</div>
					)}

					{phase === 'failed' && <p className="ui-callout ui-callout-error" role="alert"><IconAlert size={16} /><span><span className="lib-error-text">{error}</span> Your library hasn’t changed.</span></p>}
					{phase === 'cancelled' && (
						<p className="ui-callout">
							<IconCheck size={16} />
							<span>{error ? <span className="lib-error-text">{error}</span> : 'Nothing was added.'} Your library hasn’t changed.</span>
						</p>
					)}
					{(phase === 'failed' || phase === 'cancelled') && accepted.length > 0 && (
						<div className="lib-review-buttons">
							<Button variant="ghost" onClick={discard}>Discard</Button>
							<Button variant="primary" disabled={!canPublish} onClick={() => void library.publish()}>Try again</Button>
						</div>
					)}
				</section>
			)}

			{phase === 'done' && (
				<section className="lib-review" data-phase="done" aria-labelledby="review-title">
					<div className="lib-review-head">
						<div>
							<p className="ui-eyebrow lib-review-eyebrow">Done</p>
							<h2 id="review-title" ref={heading} tabIndex={-1} className="lib-section-title">{titles.done}</h2>
							<p className="lib-review-meta">{state.notice}</p>
						</div>
						<IconButton size="sm" label="Dismiss" icon={<IconX size={16} />} onClick={() => { setDoneVisible(false); addButton.current?.focus(); }} />
					</div>
				</section>
			)}

			{(!phase || phase === 'done') && (
				<button type="button" className="lib-dropzone" data-dragging={dragging || undefined} onClick={() => picker.current?.click()} disabled={state.busy}>
					<IconUpload size={20} />
					<span><strong>Drop PDFs here</strong> or choose files. You’ll review them before anything is added.</span>
				</button>
			)}

			{docs.length > 0 ? (
				<section className="lib-docs" aria-labelledby="in-library">
					<div className="lib-docs-head">
						<h2 id="in-library" className="lib-section-title">In your library</h2>
						{docs.length > 4 && (
							<label className="lib-filter">
								<IconSearch size={15} />
								<VisuallyHidden>Filter documents</VisuallyHidden>
								<input type="search" placeholder="Filter" value={filter} onChange={event => setFilter(event.currentTarget.value)} />
							</label>
						)}
					</div>
					<ul className="lib-doc-list" ref={listRef}>
						{shown.map(doc => {
							const title = documentTitle(doc);
							const on = doc.enabled !== false;
							const meta = [doc.source_filename && doc.source_filename !== title ? doc.source_filename : null, doc.page_count != null ? plural(doc.page_count, 'page', 'pages') : null].filter(Boolean).join(' · ');
							return (
								<li key={doc.document_id} className="lib-doc" data-off={!on || undefined}>
									<span className="lib-doc-icon" aria-hidden="true"><IconFile size={18} /></span>
									<div className="lib-doc-main">
										<button type="button" className="lib-doc-title" onClick={event => previewDocument(doc, event.currentTarget)}>{title}</button>
										{meta && <p className="lib-doc-meta">{meta}</p>}
									</div>
									<div className="lib-doc-toggle">
										<span className="lib-doc-toggle-label" aria-hidden="true">{on ? 'Used in answers' : 'Not used'}</span>
										<Switch checked={on} pending={pendingToggle === doc.document_id} disabled={state.busy && pendingToggle !== doc.document_id} label={`Use ${title} in answers`} onChange={next => void toggle(doc, next)} />
									</div>
									<IconButton size="sm" label={`More options for ${title}`} icon={<IconMore size={16} />} aria-haspopup="menu" aria-expanded={menu?.id === doc.document_id} onClick={event => {
										const anchor = event.currentTarget;
										setMenu(current => current?.id === doc.document_id ? null : { id: doc.document_id, anchor });
									}} />
								</li>
							);
						})}
						{shown.length === 0 && <li className="lib-doc-empty">No documents match “{filter}”.</li>}
					</ul>
				</section>
			) : !loaded ? (
				<p className="lib-loading" role="status"><Spinner size={16} /> Loading your library…</p>
			) : !phase && (
				<div className="lib-empty">
					<EmptyShelf />
					<h2>Your library is empty</h2>
					<p>Add PDFs from your approved media. They stay on this computer, and you can switch each one on or off for answers.</p>
				</div>
			)}

			{dragging && <div className="lib-drop-overlay" aria-hidden="true"><IconUpload size={28} /><p>Drop to review these files</p></div>}

			<Menu
				label="Document options"
				anchor={menu?.anchor ?? null}
				open={!!menu && !!menuDoc}
				onClose={() => setMenu(null)}
				items={[
					{ label: 'Preview', icon: <IconEye size={16} />, onSelect: () => { if (menuDoc) previewDocument(menuDoc, menu?.anchor ?? null); } },
					{ label: 'Delete…', icon: <IconTrash size={16} />, destructive: true, disabled: state.busy, onSelect: () => {
						if (menuDoc && active) setPendingDelete({ version: active.version_id, id: menuDoc.document_id, title: documentTitle(menuDoc) });
					} }
				]}
			/>
			<ConfirmDialog
				open={!!pendingDelete}
				title="Delete this document?"
				description={<><strong>{pendingDelete?.title}</strong> and its searchable passages will be removed from this library. Saved chat text remains, but source previews for older answers may no longer open. This can’t be undone.</>}
				confirmLabel="Delete document"
				onCancel={() => setPendingDelete(null)}
				onConfirm={async () => {
					if (pendingDelete) await library.deleteDocument(pendingDelete.version, pendingDelete.id);
					setPendingDelete(null);
				}}
				fallbackFocus={() => listRef.current?.querySelector<HTMLElement>('.lib-doc-title') ?? addButton.current}
			/>
		</div>
	);
}

function EmptyShelf() {
	return (
		<svg width="120" height="84" viewBox="0 0 120 84" aria-hidden="true" className="lib-empty-art">
			<rect x="14" y="76" width="92" height="3" rx="1.5" fill="var(--line-strong)" />
			<rect x="26" y="22" width="16" height="54" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5" />
			<rect x="45" y="30" width="14" height="46" rx="3" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" />
			<rect x="66" y="16" width="16" height="60" rx="3" transform="rotate(12 74 46)" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 3" />
			<rect x="29" y="40" width="10" height="3" rx="1.5" fill="var(--saffron)" />
		</svg>
	);
}
