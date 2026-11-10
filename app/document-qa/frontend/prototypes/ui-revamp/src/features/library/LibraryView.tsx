import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { LibraryDoc } from '../../data/samples';
import { useStore, type Publication } from '../../store';
import { IconAlert, IconCheck, IconEye, IconFile, IconMore, IconSearch, IconTrash, IconUpload, IconX } from '../../ui/icons';
import { ConfirmDialog, Menu } from '../../ui/overlay';
import { Button, Spinner, Switch, formatBytes, formatRelative } from '../../ui/primitives';
import { sampleReviewFiles, type ReviewFile } from '../../sim/review';

export function LibraryView() {
	const store = useStore();
	const { docs, publication } = store;
	const input = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const [dragging, setDragging] = useState(false);
	const [filter, setFilter] = useState('');
	const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
	const [confirm, setConfirm] = useState<string | null>(null);
	const locked = publication?.phase === 'publishing' || publication?.phase === 'checking';
	const enabled = docs.filter(d => d.enabled);
	const pages = enabled.reduce((n, d) => n + d.pages, 0);
	const shown = useMemo(() => docs.filter(d => `${d.title} ${d.filename}`.toLowerCase().includes(filter.toLowerCase())), [docs, filter]);
	const target = docs.find(d => d.id === confirm);

	const pick = async (files: FileList | File[] | null) => {
		if (!files || !files.length || locked) return;
		const list = await Promise.all(Array.from(files).map(async f => ({ name: f.name, size: f.size, data: await f.arrayBuffer() })));
		void store.startReview(list);
	};

	const preview = (doc: LibraryDoc, anchor?: HTMLElement | null) => store.openPdf({
		key: `doc-${doc.id}`, title: doc.title, subtitle: doc.filename, page: 1, load: () => store.docBytes(doc), returnFocus: anchor ?? undefined,
	});

	const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void pick(e.dataTransfer.files); };

	return (
		<div className="view library" onDragOver={e => { if (!locked) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop}>
			<div className="view-inner">
				<header className="view-head">
					<div>
						<h1 className="view-title">Library</h1>
						<p className="view-sub">
							{docs.length
								? <>{enabled.length} of {docs.length} documents are used for answers · {pages} pages</>
								: 'PDFs you add here become the evidence for every answer.'}
						</p>
					</div>
					<div className="view-actions">
						<Button variant="primary" icon={<IconUpload size={16} />} onClick={() => input.current?.click()} disabled={locked}>Add PDFs</Button>
						<input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => { void pick(e.target.files); e.target.value = ''; }} />
					</div>
				</header>

				{publication && <ReviewPanel publication={publication} onPreview={(f, anchor) => store.openPdf({ key: `review-${f.id}`, title: f.title ?? f.name, subtitle: `${f.name} · not in your library yet`, page: 1, load: async () => f.data!, returnFocus: anchor })} />}

				{!publication && (
					<button type="button" className="dropzone" data-dragging={dragging || undefined} onClick={() => input.current?.click()} disabled={locked}>
						<IconUpload size={20} />
						<span><strong>Drop PDFs here</strong> or choose files. You’ll review them before anything is added.</span>
					</button>
				)}
				{!publication && (
					<p className="proto-inline">
						<span className="proto-tag">Prototype</span> No PDFs handy?{' '}
						<button type="button" className="link-btn" onClick={async () => store.startReview(await sampleReviewFiles())}>Review a sample set</button>
						{' '}with files that pass and fail.
					</p>
				)}

				{docs.length > 0 ? (
					<section className="doc-section" aria-labelledby="in-library">
						<div className="doc-section-head">
							<h2 id="in-library" className="section-title">In your library</h2>
							{docs.length > 4 && (
								<label className="filter">
									<IconSearch size={15} />
									<span className="sr-only">Filter documents</span>
									<input type="search" placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
								</label>
							)}
						</div>
						<ul className="doc-list" ref={listRef}>
							{shown.map(doc => (
								<li key={doc.id} className="doc-row" data-off={!doc.enabled || undefined} data-new={doc.isNew || undefined}>
									<span className="doc-icon" aria-hidden="true"><IconFile size={18} /></span>
									<div className="doc-main">
										<button type="button" className="doc-title" onClick={e => preview(doc, e.currentTarget)}>{doc.title}</button>
										<p className="doc-meta">
											{doc.isNew && <span className="new-dot">New · </span>}
											{doc.filename} · {doc.pages} pages · Added {addedLabel(doc.addedAt)}
										</p>
									</div>
									<div className="doc-toggle">
										<span className="doc-toggle-label" id={`lbl-${doc.id}`} aria-hidden="true">{doc.enabled ? 'Used in answers' : 'Not used'}</span>
										<Switch checked={doc.enabled} pending={store.pendingDocs.has(doc.id)} label={`Use ${doc.title} in answers`} onChange={v => void store.setDocEnabled(doc.id, v)} disabled={locked} />
									</div>
									<button type="button" className="icon-btn icon-btn-sm" aria-label={`More options for ${doc.title}`} aria-haspopup="menu" aria-expanded={menu?.id === doc.id} onClick={e => setMenu(m => (m?.id === doc.id ? null : { id: doc.id, anchor: e.currentTarget }))}>
										<IconMore size={16} />
									</button>
								</li>
							))}
							{shown.length === 0 && <li className="doc-empty">No documents match “{filter}”.</li>}
						</ul>
					</section>
				) : !publication && (
					<div className="empty-state">
						<EmptyShelf />
						<h2>Your library is empty</h2>
						<p>Add PDFs from your approved media. They stay on this computer, and you can switch each one on or off for answers.</p>
					</div>
				)}
			</div>

			{dragging && <div className="drop-overlay" aria-hidden="true"><IconUpload size={28} /><p>Drop to review these files</p></div>}

			<Menu
				label="Document options"
				anchor={menu?.anchor ?? null}
				open={!!menu}
				onClose={() => setMenu(null)}
				items={[
					{ label: 'Preview', icon: <IconEye size={16} />, onSelect: () => { const d = docs.find(x => x.id === menu?.id); if (d) preview(d, menu?.anchor); } },
					{ label: 'Delete…', icon: <IconTrash size={16} />, destructive: true, onSelect: () => setConfirm(menu?.id ?? null) },
				]}
			/>
			<ConfirmDialog
				open={!!target}
				title="Delete this document?"
				description={<><strong>{target?.title}</strong> and its searchable text will be removed from this computer. Past answers keep their quotes, but its pages can no longer be opened. This can’t be undone.</>}
				confirmLabel="Delete document"
				onCancel={() => setConfirm(null)}
				onConfirm={async () => { if (target) await store.deleteDoc(target.id); setConfirm(null); }}
				fallbackFocus={() => listRef.current?.querySelector<HTMLElement>('.doc-title') ?? document.querySelector<HTMLElement>('.view-actions .btn')}
			/>
		</div>
	);
}

function ReviewPanel({ publication: p, onPreview }: { publication: Publication; onPreview: (f: ReviewFile, anchor: HTMLElement) => void }) {
	const store = useStore();
	const accepted = p.files.filter(f => f.status === 'accepted');
	const rejected = p.files.filter(f => f.status === 'rejected');
	const heading = useRef<HTMLHeadingElement>(null);
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (p.phase !== 'publishing' || !p.startedAt) return;
		const t = window.setInterval(() => setElapsed(Math.round((Date.now() - (p.startedAt ?? Date.now())) / 1000)), 500);
		return () => window.clearInterval(t);
	}, [p.phase, p.startedAt]);
	useEffect(() => { if (p.phase === 'ready' || p.phase === 'done' || p.phase === 'failed' || p.phase === 'cancelled') heading.current?.focus(); }, [p.phase]);

	const title = {
		checking: `Checking ${p.files.length} ${p.files.length === 1 ? 'file' : 'files'}…`,
		ready: rejected.length ? `${accepted.length} of ${p.files.length} files can be added` : `${accepted.length} ${accepted.length === 1 ? 'file is' : 'files are'} ready to add`,
		publishing: `Adding ${accepted.length} ${accepted.length === 1 ? 'document' : 'documents'}`,
		done: `Added ${p.added ?? accepted.length} ${(p.added ?? accepted.length) === 1 ? 'document' : 'documents'} to your library`,
		failed: 'These files weren’t added',
		cancelled: 'Adding was cancelled',
	}[p.phase];

	const needsConfirm = rejected.length > 0 && accepted.length > 0;
	const canPublish = p.phase === 'ready' && accepted.length > 0 && (!needsConfirm || p.confirmSkip);
	const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
	const totalPages = accepted.reduce((n, f) => n + (f.pages ?? 0), 0);

	return (
		<section className="review" data-phase={p.phase} aria-labelledby="review-title">
			<div className="review-head">
				<div>
					<p className="eyebrow review-eyebrow">{p.phase === 'done' ? 'Done' : 'Waiting for your review · not used in answers yet'}</p>
					<h2 id="review-title" ref={heading} tabIndex={-1} className="section-title">{title}</h2>
				</div>
				{(p.phase === 'ready' || p.phase === 'done' || p.phase === 'failed' || p.phase === 'cancelled') && (
					<button type="button" className="icon-btn icon-btn-sm" aria-label={p.phase === 'done' ? 'Dismiss' : 'Discard this review'} onClick={store.dismissReview}><IconX size={16} /></button>
				)}
			</div>

			{p.phase === 'publishing' ? (
				<div className="progress-block" role="status" aria-live="polite">
					<div className="progress" aria-hidden="true"><span style={{ width: `${Math.max(6, (p.filesDone / Math.max(1, accepted.length)) * 92)}%` }} /></div>
					<p className="progress-step">{p.step}</p>
					<p className="progress-meta">{p.filesDone} of {accepted.length} files · {p.pagesDone} of {totalPages} pages · {mmss} elapsed</p>
					<p className="progress-note">Your current library keeps working while this runs. You can leave this page.</p>
					<Button variant="secondary" size="sm" onClick={store.cancelPublication}>Cancel</Button>
				</div>
			) : (
				<ul className="review-list">
					{p.files.map(f => (
						<li key={f.id} className="review-row" data-status={f.status}>
							<span className="review-icon" aria-hidden="true">
								{f.status === 'checking' ? <Spinner size={16} /> : f.status === 'accepted' ? <IconCheck size={16} /> : <IconX size={16} />}
							</span>
							<div className="review-main">
								<p className="review-name">{f.title && f.status === 'accepted' ? f.title : f.name}</p>
								<p className="review-meta">
									{f.status === 'checking' && 'Checking…'}
									{f.status === 'accepted' && <>{f.name} · {f.pages} pages · {formatBytes(f.size)}{f.note ? ` · ${f.note}` : ''}</>}
									{f.status === 'rejected' && <><span className="sr-only">Can’t be added: </span>{f.reason}</>}
								</p>
							</div>
							{f.status === 'accepted' && p.phase !== 'done' && (
								<Button size="sm" variant="ghost" icon={<IconEye size={15} />} onClick={e => onPreview(f, e.currentTarget)}>Preview</Button>
							)}
						</li>
					))}
				</ul>
			)}

			{p.phase === 'failed' && <p className="callout callout-error" role="alert"><IconAlert size={16} /><span>{p.error} Your library hasn’t changed.</span></p>}
			{p.phase === 'cancelled' && <p className="callout" role="status"><IconCheck size={16} /><span>Nothing was added. Your library hasn’t changed.</span></p>}

			{p.phase === 'ready' && (
				<div className="review-foot">
					{needsConfirm && (
						<label className="check">
							<input type="checkbox" checked={p.confirmSkip} onChange={e => store.setConfirmSkip(e.target.checked)} />
							<span>Add the {accepted.length} {accepted.length === 1 ? 'file that passed' : 'files that passed'} and skip {rejected.length} that can’t be added</span>
						</label>
					)}
					{accepted.length === 0 && <p className="review-none">None of these files can be added. Fix the issues above, then try again.</p>}
					<div className="review-buttons">
						<Button variant="ghost" onClick={store.dismissReview}>Cancel</Button>
						<Button variant="primary" disabled={!canPublish} onClick={() => void store.publish()}>
							Add {accepted.length} {accepted.length === 1 ? 'document' : 'documents'}
						</Button>
					</div>
				</div>
			)}
			{(p.phase === 'failed' || p.phase === 'cancelled') && accepted.length > 0 && (
				<div className="review-buttons">
					<Button variant="ghost" onClick={store.dismissReview}>Discard</Button>
					<Button variant="primary" onClick={() => void store.publish()}>Try again</Button>
				</div>
			)}
		</section>
	);
}

function addedLabel(ts: number): string {
	const rel = formatRelative(ts);
	return /^[A-Z][a-z]+ \d/.test(rel) ? rel : rel.toLowerCase();
}

function EmptyShelf() {
	return (
		<svg width="120" height="84" viewBox="0 0 120 84" aria-hidden="true" className="empty-art">
			<rect x="14" y="76" width="92" height="3" rx="1.5" fill="var(--line-strong)" />
			<rect x="26" y="22" width="16" height="54" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5" />
			<rect x="45" y="30" width="14" height="46" rx="3" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" />
			<rect x="66" y="16" width="16" height="60" rx="3" transform="rotate(12 74 46)" fill="var(--paper-raised)" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 3" />
			<rect x="29" y="40" width="10" height="3" rx="1.5" fill="#f2c25a" />
		</svg>
	);
}
