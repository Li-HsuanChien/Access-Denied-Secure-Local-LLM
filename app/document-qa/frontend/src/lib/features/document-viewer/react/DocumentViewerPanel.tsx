import { useCallback, type KeyboardEvent } from 'react';
import type { OpenDocument } from '../../../../react/providers';
import { PdfPreview } from '../../library/react/PdfPreview';
import './document-viewer.css';

export type DocumentViewerMode = 'side' | 'overlay';

/**
 * Body for the shell's document slot. Bytes are read only via request.load() (called by the viewer
 * on mount and on Try again) and rendered by the hardened PdfPreview (pdf.js canvas + text layer;
 * never an iframe/embed). Side mode: Close button, focus on the title, Escape closes. Overlay mode:
 * Back button; the shell's modal Dialog owns focus trapping and Escape.
 */
export function DocumentViewerPanel({ request, mode, onClose }: { request: OpenDocument; mode: DocumentViewerMode; onClose: () => void }) {
	const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
		if (mode === 'side' && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); }
	}, [mode, onClose]);

	return (
		<div className="docview" data-document-viewer={mode} onKeyDown={onKeyDown}>
			<PdfPreview
				load={request.load}
				citation={request.citation}
				initialPage={request.page}
				title={request.title}
				subtitle={request.subtitle}
				mode={mode}
				onClose={onClose}
			/>
		</div>
	);
}
