/*
 * Document viewer. Uses the bundled pdf.js with production's hardened options
 * (see sim/pdf.ts). Pages render lazily as they scroll into view. Highlights
 * use the citation's stored `highlight_rects` (PDF points, top-left origin)
 * when `coordinates_reliable`, exactly as production does.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfTarget } from '../../store';
import { loadPdfJs, openPdf } from '../../sim/pdf';
import { IconArrowLeft, IconChevronDown, IconChevronLeft, IconChevronRight, IconMinus, IconPlus, IconX } from '../../ui/icons';
import { Button, IconButton, Spinner, pageLabel } from '../../ui/primitives';

type Zoom = 'fit' | number;

/** Smooth scroll with an instant fallback for webviews that throttle smooth scrolling. */
function scrollToTop(el: HTMLElement | null, top: number, smooth: boolean) {
	if (!el) return;
	el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
	if (smooth) window.setTimeout(() => { if (Math.abs(el.scrollTop - top) > 4 && el.scrollHeight - el.clientHeight > el.scrollTop + 4) el.scrollTo({ top }); }, 450);
}
const PAD = 28;

export function PdfViewer({ target, onClose, mode }: { target: PdfTarget; onClose: () => void; mode: 'side' | 'overlay' }) {
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
	const [error, setError] = useState('');
	const [attempt, setAttempt] = useState(0);
	const [zoom, setZoom] = useState<Zoom>('fit');
	const [width, setWidth] = useState(0);
	const [page, setPage] = useState(target.page);
	const [pageInput, setPageInput] = useState(String(target.page));
	// On small screens the quote starts collapsed so the page gets the room.
	const [quoteOpen, setQuoteOpen] = useState(() => !window.matchMedia('(max-width: 640px)').matches);
	const scroller = useRef<HTMLDivElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const scrolledToTarget = useRef(false);
	const citation = target.citation;

	useEffect(() => { if (mode === 'side') heading.current?.focus({ preventScroll: true }); }, [mode]);

	useEffect(() => {
		let active = true;
		let task: Awaited<ReturnType<typeof openPdf>> | null = null;
		setDoc(null); setError(''); setSizes([]);
		(async () => {
			const data = await target.load();
			task = await openPdf(data);
			const pdf = await task.promise;
			const all = await Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
				const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
				return { w: vp.width, h: vp.height };
			}));
			if (!active) return;
			setSizes(all); setDoc(pdf);
		})().catch(() => { if (active) setError('This PDF couldn’t be opened.'); });
		return () => { active = false; void task?.destroy(); };
	}, [target, attempt]);

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setWidth(el.clientWidth));
		ro.observe(el);
		setWidth(el.clientWidth);
		return () => ro.disconnect();
	}, []);

	const maxW = sizes.reduce((m, s) => Math.max(m, s.w), 0) || 612;
	const fitScale = Math.max(0.4, Math.min(2, (width - PAD * 2) / maxW));
	const scale = zoom === 'fit' ? fitScale : zoom;

	const pageTop = useCallback((n: number) => {
		let top = PAD;
		for (let i = 0; i < n - 1; i++) top += (sizes[i]?.h ?? 792) * scale + 16;
		return top;
	}, [sizes, scale]);

	const goTo = useCallback((n: number, smooth = true) => {
		const clamped = Math.max(1, Math.min(sizes.length || 1, n));
		setPage(clamped); setPageInput(String(clamped));
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		scrollToTop(scroller.current, pageTop(clamped) - 12, smooth && !reduce);
	}, [sizes.length, pageTop]);

	const jumpToHighlight = useCallback((smooth = true) => {
		if (!citation) return;
		const first = citation.pages.find(p => p.page_number === citation.page_start);
		const rect = first?.coordinates_reliable ? first.highlight_rects[0] : null;
		const top = pageTop(citation.page_start) + (rect ? rect[1] * scale - 96 : 0);
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		scrollToTop(scroller.current, Math.max(0, top), smooth && !reduce);
		setPage(citation.page_start); setPageInput(String(citation.page_start));
	}, [citation, pageTop, scale]);

	// Land on the cited passage (or requested page) once the layout is known.
	useEffect(() => {
		if (!doc || !width || scrolledToTarget.current) return;
		scrolledToTarget.current = true;
		window.setTimeout(() => (citation ? jumpToHighlight(false) : goTo(target.page, false)), 0);
	}, [doc, width, citation, jumpToHighlight, goTo, target.page]);

	const onScroll = () => {
		const el = scroller.current;
		if (!el || !sizes.length) return;
		const probe = el.scrollTop + el.clientHeight * 0.35;
		let n = 1;
		for (let i = 1; i <= sizes.length; i++) if (pageTop(i) <= probe) n = i;
		if (n !== page) { setPage(n); setPageInput(String(n)); }
	};

	const zoomBy = (delta: number) => setZoom(z => {
		const current = z === 'fit' ? fitScale : z;
		return Math.round(Math.max(0.5, Math.min(3, current + delta)) * 100) / 100;
	});

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const inInput = (e.target as HTMLElement).tagName === 'INPUT';
		if (e.key === 'Escape' && mode === 'side') { e.stopPropagation(); onClose(); return; }
		if (inInput) return;
		if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(0.15); }
		else if (e.key === '-') { e.preventDefault(); zoomBy(-0.15); }
		else if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
		else if (e.key === 'ArrowRight' && (e.target as HTMLElement).closest('.pdf-toolbar') === null) { e.preventDefault(); goTo(page + 1); }
		else if (e.key === 'ArrowLeft' && (e.target as HTMLElement).closest('.pdf-toolbar') === null) { e.preventDefault(); goTo(page - 1); }
	};

	const total = sizes.length;
	return (
		<div className={`pdf-viewer pdf-viewer-${mode}`} onKeyDown={onKeyDown}>
			<div className="pdf-toolbar" role="toolbar" aria-label="Document controls">
				{mode === 'overlay' ? (
					<Button variant="ghost" size="sm" icon={<IconArrowLeft size={16} />} onClick={onClose}>Back</Button>
				) : (
					<IconButton label="Close document" icon={<IconX />} onClick={onClose} />
				)}
				<div className="pdf-title-wrap">
					<h2 className="pdf-title" ref={heading} tabIndex={-1}>{target.title}</h2>
					{target.subtitle && <p className="pdf-subtitle">{target.subtitle}</p>}
				</div>
				<div className="pdf-controls">
					<div className="pdf-pager">
						<IconButton size="sm" label="Previous page" icon={<IconChevronLeft size={16} />} disabled={!total || page <= 1} onClick={() => goTo(page - 1)} />
						<label className="pdf-page-input">
							<span className="sr-only">Page</span>
							<input
								inputMode="numeric"
								value={pageInput}
								disabled={!total}
								onChange={e => setPageInput(e.target.value.replace(/\D/g, ''))}
								onKeyDown={e => { if (e.key === 'Enter') goTo(Number(pageInput) || page); }}
								onBlur={() => setPageInput(String(page))}
							/>
							<span aria-hidden="true">/ {total || '–'}</span>
							<span className="sr-only">of {total}</span>
						</label>
						<IconButton size="sm" label="Next page" icon={<IconChevronRight size={16} />} disabled={!total || page >= total} onClick={() => goTo(page + 1)} />
					</div>
					<div className="pdf-zoom">
						<IconButton size="sm" label="Zoom out" icon={<IconMinus size={16} />} disabled={!total || scale <= 0.5} onClick={() => zoomBy(-0.15)} />
						<button type="button" className="pdf-zoom-label" onClick={() => setZoom(z => (z === 'fit' ? 1 : 'fit'))} disabled={!total} aria-label={zoom === 'fit' ? `Fit to width, ${Math.round(scale * 100)} percent. Switch to actual size` : `${Math.round(scale * 100)} percent. Fit to width`}>
							{zoom === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`}
						</button>
						<IconButton size="sm" label="Zoom in" icon={<IconPlus size={16} />} disabled={!total || scale >= 3} onClick={() => zoomBy(0.15)} />
					</div>
				</div>
			</div>

			{citation && (
				<div className="pdf-quote" data-open={quoteOpen || undefined}>
					<button type="button" className="pdf-quote-toggle" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(o => !o)}>
						<span className="hl-swatch" aria-hidden="true" />
						Highlighted passage · {pageLabel(citation.page_start, citation.page_end)}
						<IconChevronDown size={15} className="chev" />
					</button>
					{quoteOpen && (
						<div className="pdf-quote-body">
							<blockquote>{citation.quote}</blockquote>
							<button type="button" className="link-btn" onClick={() => jumpToHighlight()} disabled={!doc}>Go to highlight</button>
						</div>
					)}
				</div>
			)}

			<div className="pdf-scroll" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label={`${target.title}, page ${page} of ${total || 'unknown'}`}>
				{error ? (
					<div className="pdf-state" role="alert">
						<p><strong>{error}</strong> {citation ? 'The quoted passage above is still accurate.' : 'Close it and try again, or check that the file still exists.'}</p>
						<Button size="sm" onClick={() => setAttempt(a => a + 1)}>Try again</Button>
					</div>
				) : !doc ? (
					<div className="pdf-pages" aria-busy="true">
						<div className="pdf-skeleton" style={{ width: Math.max(240, width - PAD * 2), height: Math.max(240, width - PAD * 2) * 1.29 }}>
							<span className="pdf-loading" role="status"><Spinner size={16} /> Opening document…</span>
						</div>
					</div>
				) : (
					<div className="pdf-pages" style={{ paddingTop: PAD, paddingBottom: PAD }}>
						{sizes.map((s, i) => (
							<PdfPage key={i} doc={doc} n={i + 1} w={s.w * scale} h={s.h * scale} scale={scale}
								highlights={citation?.pages.find(p => p.page_number === i + 1 && p.coordinates_reliable)?.highlight_rects ?? []} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function PdfPage({ doc, n, w, h, scale, highlights }: { doc: PDFDocumentProxy; n: number; w: number; h: number; scale: number; highlights: readonly (readonly number[])[] }) {
	const box = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [rendered, setRendered] = useState(false);

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: el.closest('.pdf-scroll'), rootMargin: '600px 0px' });
		io.observe(el);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		const el = box.current;
		if (!visible || !el) return;
		let active = true;
		let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
		let textLayer: { cancel: () => void } | null = null;
		setRendered(false);
		(async () => {
			const pdf = await loadPdfJs();
			const source = await doc.getPage(n);
			if (!active) return;
			const viewport = source.getViewport({ scale });
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const canvas = document.createElement('canvas');
			canvas.width = Math.floor(viewport.width * dpr);
			canvas.height = Math.floor(viewport.height * dpr);
			canvas.style.width = `${viewport.width}px`;
			canvas.style.height = `${viewport.height}px`;
			canvas.setAttribute('aria-hidden', 'true');
			renderTask = source.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
			await renderTask.promise;
			if (!active) return;
			const layer = document.createElement('div');
			layer.className = 'textLayer';
			const tl = new pdf.TextLayer({ textContentSource: await source.getTextContent(), container: layer, viewport });
			textLayer = tl;
			await tl.render();
			if (!active) return;
			const surface = el.querySelector('.pdf-surface');
			surface?.replaceChildren(canvas, layer);
			setRendered(true);
		})().catch(() => undefined);
		return () => { active = false; renderTask?.cancel(); textLayer?.cancel(); };
	}, [visible, doc, n, scale]);

	return (
		<div ref={box} className="pdf-page" data-page={n} style={{ width: w, height: h, ['--scale-factor' as string]: scale, ['--total-scale-factor' as string]: scale }}>
			<div className="pdf-surface" />
			{!rendered && <span className="pdf-page-placeholder" aria-hidden="true" />}
			{highlights.map((r, i) => (
				<span key={i} className="pdf-hl" aria-hidden="true" style={{ left: r[0] * scale - 2, top: r[1] * scale - 1.5, width: (r[2] - r[0]) * scale + 4, height: (r[3] - r[1]) * scale + 3 }} />
			))}
			<span className="pdf-page-num" aria-hidden="true">{n}</span>
		</div>
	);
}
