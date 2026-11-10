import { useId } from 'react';
import type { Citation } from '$lib/features/answering/types';
import { useStore } from '../../store';
import { IconFile, IconOpenPage, IconX } from '../../ui/icons';
import { Popover } from '../../ui/overlay';
import { Button, pageLabel } from '../../ui/primitives';

/**
 * Quote-first source preview: anchored, non-modal, plain-text quote.
 * The PDF is only fetched when "Show document page" is chosen.
 */
export function CitationPopover({ citation, index, anchor, onClose }: { citation: Citation | null; index: number; anchor: HTMLElement | null; onClose: () => void }) {
	const store = useStore();
	const titleId = useId();
	if (!citation) return null;
	const doc = store.docs.find(d => d.id === citation.document_id);
	const pages = pageLabel(citation.page_start, citation.page_end);

	const show = () => {
		if (!doc) return;
		onClose();
		store.openPdf({
			key: `${doc.id}-${citation.citation_id}`,
			title: doc.title,
			subtitle: doc.filename,
			page: citation.page_start,
			citation,
			load: () => store.docBytes(doc),
			returnFocus: anchor,
		});
	};

	return (
		<Popover anchor={anchor} open={!!citation} onClose={onClose} labelledBy={titleId} side="bottom" align="start" className="cite-popover">
			<div className="cite-head">
				<span className="cite-index" aria-hidden="true">{index + 1}</span>
				<div className="cite-meta">
					<h2 id={titleId} className="cite-title">{citation.document_title}</h2>
					<p className="cite-pages">{pages}{doc && !doc.enabled ? ' · Not used for new answers' : ''}</p>
				</div>
				<button type="button" className="icon-btn icon-btn-sm" aria-label="Close source" onClick={onClose}><IconX size={16} /></button>
			</div>
			<figure className="source-quote">
				<figcaption className="eyebrow">Original text</figcaption>
				<blockquote>{citation.quote}</blockquote>
			</figure>
			<div className="cite-foot">
				{doc ? (
					<Button variant="secondary" size="sm" icon={<IconOpenPage size={16} />} onClick={show}>Show document page</Button>
				) : (
					<p className="cite-missing"><IconFile size={14} /> This document was removed from your library. The quote was saved with the answer, but the page can’t be shown.</p>
				)}
			</div>
		</Popover>
	);
}
