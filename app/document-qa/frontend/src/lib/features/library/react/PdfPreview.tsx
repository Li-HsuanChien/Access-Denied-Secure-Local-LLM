/*
 * Hardened PDF viewer (pdf.js canvas + text layer; never an iframe/embed). Ported from
 * prototypes/ui-revamp/src/features/pdf/PdfViewer.tsx onto production's pdf.js options.
 * All PDF bytes come from a local file or the validated loopback source client.
 * Pages render lazily as they scroll into view; citation highlights use highlight_rects when
 * coordinates_reliable, else a text-layer quote match on the citation's first page.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist';
import type { Citation, Immutable } from '../../react-contracts';
import {
	Button, IconButton, Spinner, pageLabel,
	IconArrowLeft, IconChevronDown, IconChevronLeft, IconChevronRight, IconMinus, IconPlus, IconX
} from '../../design-system/react';
import './PdfPreview.css';

export type PdfPreviewMode = 'side' | 'overlay' | 'inline';
export interface PdfPreviewProps {
	/** Bytes already in memory (for example, a local file). */
	data?: ArrayBuffer;
	/** Or a loader, called once on mount and again on Try again. Used when `data` is absent. */
	load?: () => Promise<ArrayBuffer>;
	citation?: Immutable<Citation>;
	/** Page to open on; defaults to the citation's first page. */
	initialPage?: number;
	/** Toolbar heading (plain, untrusted text). Shown in side/overlay mode. */
	title?: string;
	subtitle?: string;
	/** side: Close button; overlay: Back button; inline (default): controls only. */
	mode?: PdfPreviewMode;
	onClose?: () => void;
}

type Zoom = 'fit' | number;
type Rect = readonly number[];
const PAD = 28;
const GAP = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;
/** Largest canvas area browsers reliably allocate (Safari/WebKit limit). */
const MAX_CANVAS_PIXELS = 16_777_216;

/** Loads the bundled pdf.js and points it at the bundled worker (no CDN). */
let pdfJs: Promise<typeof import('pdfjs-dist')> | null = null;
export function loadPdfJs() {
	pdfJs ??= import('pdfjs-dist').then(pdf => {
		pdf.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
		return pdf;
	}).catch(cause => { pdfJs = null; throw cause; });
	return pdfJs;
}

/** Production's hardened pdf.js document options. Do not loosen. */
export const HARDENED_PDF_OPTIONS = { isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true } as const;

function media(query: string): boolean {
	try { return typeof window.matchMedia === 'function' && window.matchMedia(query).matches; } catch { return false; }
}
const reducedMotion = () => media('(prefers-reduced-motion: reduce)');

/** Sets scroll position. Smooth scrolling gets an instant fallback (webviews may throttle it). */
function scrollToTop(el: HTMLElement | null, top: number, smooth: boolean) {
	if (!el) return;
	const target = Math.max(0, top);
	if (smooth && typeof el.scrollTo === 'function') {
		el.scrollTo({ top: target, behavior: 'smooth' });
		window.setTimeout(() => {
			if (Math.abs(el.scrollTop - target) > 4 && el.scrollHeight - el.clientHeight > el.scrollTop + 4) el.scrollTop = target;
		}, 450);
	} else {
		el.scrollTop = target;
	}
}

/** Converts a stored rect (PDF points, top-left origin) into page-relative CSS pixels. */
export function rectToBox(base: PageViewport, scale: number, rect: Rect) {
	const vp = base.clone({ scale });
	const [x0, y0, x1, y1] = vp.convertToViewportRectangle([rect[0], base.height - rect[1], rect[2], base.height - rect[3]]);
	return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** Existing text-layer fallback: the first run of spans that contains the quote's first significant words
 * (edge punctuation is ignored so "metres." still matches "metres"). */
export function findQuoteSpans<T extends { textContent: string | null }>(spans: readonly T[], quote: string): T[] {
	const words = quote.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(word => word.length > 2).slice(0, 6);
	if (!words.length) return [];
	for (let i = 0; i < spans.length; i++) {
		if (!(spans[i].textContent ?? '').toLowerCase().includes(words[0])) continue;
		const group: T[] = []; let combined = '';
		for (let j = i; j < Math.min(spans.length, i + 40); j++) {
			group.push(spans[j]); combined += ` ${spans[j].textContent ?? ''}`;
			if (words.every(word => combined.toLowerCase().includes(word))) return group;
		}
	}
	return [];
}

function reliableRects(citation: Immutable<Citation> | undefined, page: number): readonly Rect[] {
	const evidence = citation?.pages.find(p => p.page_number === page);
	return evidence?.coordinates_reliable && evidence.highlight_rects.length ? evidence.highlight_rects : [];
}

export function PdfPreview({ data, load, citation, initialPage, title, subtitle, mode = 'inline', onClose }: PdfPreviewProps) {
	const startPage = initialPage ?? citation?.page_start ?? 1;
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [views, setViews] = useState<PageViewport[]>([]);
	const [error, setError] = useState<{ detail: string } | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [zoom, setZoom] = useState<Zoom>('fit');
	const [width, setWidth] = useState(0);
	const [page, setPage] = useState(startPage);
	const [pageInput, setPageInput] = useState(String(startPage));
	// On small screens the passage starts collapsed so the page gets the room.
	const [quoteOpen, setQuoteOpen] = useState(() => !media('(max-width: 640px)'));
	// SDD: a failed source fetch leaves the supporting quotation visible.
	useEffect(() => { if (error && citation) setQuoteOpen(true); }, [error, citation]);
	const [fallbackTop, setFallbackTop] = useState<number | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	/** True until the person scrolls or navigates: keeps the view pinned to the opening target through re-layouts. */
	const anchored = useRef(true);
	const loadRef = useRef(load);
	loadRef.current = load;
	const pageInputId = `pdf-page-of-${useRef(Math.random().toString(36).slice(2)).current}`;

	useEffect(() => { if (mode === 'side') heading.current?.focus({ preventScroll: true }); }, [mode]);

	useEffect(() => {
		let active = true;
		let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
		setDoc(null); setViews([]); setError(null); setFallbackTop(null);
		anchored.current = true;
		// Read bytes first (synchronously starts the host request), then parse with hardened options.
		const bytes = data ? Promise.resolve(data) : loadRef.current ? loadRef.current() : Promise.reject(new Error('No document to show.'));
		void (async () => {
			const source = await bytes;
			const pdf = await loadPdfJs();
			if (!active) return;
			task = pdf.getDocument({ data: new Uint8Array(source.slice(0)), ...HARDENED_PDF_OPTIONS });
			const opened = await task.promise;
			const measured = await Promise.all(Array.from({ length: opened.numPages }, async (_, i) => (await opened.getPage(i + 1)).getViewport({ scale: 1 })));
			if (!active) return;
			setViews(measured); setDoc(opened);
		})().catch(cause => { if (active) setError({ detail: cause instanceof Error ? cause.message : '' }); });
		return () => { active = false; if (task) void task.destroy(); };
	}, [data, attempt]);

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		setWidth(el.clientWidth);
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => setWidth(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const total = views.length;
	const maxW = views.reduce((m, v) => Math.max(m, v.width), 0) || 612;
	const fitScale = Math.max(0.4, Math.min(2, ((width || 760) - PAD * 2) / maxW));
	const scale = zoom === 'fit' ? fitScale : zoom;

	const pageTop = useCallback((n: number) => {
		const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
		if (el && el.offsetParent) return el.offsetTop;
		let top = PAD;
		for (let i = 0; i < n - 1; i++) top += (views[i]?.height ?? 792) * scale + GAP;
		return top;
	}, [views, scale]);

	const clampPage = useCallback((n: number) => Math.max(1, Math.min(total || 1, n)), [total]);

	const goTo = useCallback((n: number, smooth = true) => {
		const clamped = clampPage(n);
		anchored.current = false;
		setPage(clamped); setPageInput(String(clamped));
		scrollToTop(scroller.current, pageTop(clamped) - 12, smooth && !reducedMotion());
	}, [clampPage, pageTop]);

	const highlightTop = useCallback((): number | null => {
		if (!citation) return null;
		const first = citation.page_start;
		const rects = reliableRects(citation, first);
		const base = views[first - 1];
		if (rects.length && base) return pageTop(first) + Math.min(...rects.map(r => rectToBox(base, scale, r).top)) - 96;
		if (fallbackTop != null) return pageTop(first) + fallbackTop - 96;
		return pageTop(first) - 12;
	}, [citation, views, scale, pageTop, fallbackTop]);

	const jumpToHighlight = useCallback(() => {
		const top = highlightTop();
		if (top == null || !citation) return;
		anchored.current = false;
		setPage(citation.page_start); setPageInput(String(citation.page_start));
		scrollToTop(scroller.current, top, !reducedMotion());
	}, [citation, highlightTop]);

	// Land on the cited passage (or requested page) instantly once laid out, and stay there through
	// re-layouts (scale changes, late text-layer matches) until the person moves. No rAF/smooth reliance.
	useLayoutEffect(() => {
		if (!doc || !total || !anchored.current) return;
		const land = () => {
			if (!anchored.current) return;
			const onHighlight = citation && startPage === citation.page_start;
			const top = onHighlight ? highlightTop() : pageTop(clampPage(startPage)) - 12;
			if (top != null) scrollToTop(scroller.current, top, false);
			const shown = clampPage(onHighlight ? citation.page_start : startPage);
			setPage(shown); setPageInput(String(shown));
		};
		land();
		const timer = window.setTimeout(land, 0);
		return () => window.clearTimeout(timer);
	}, [doc, total, scale, citation, startPage, highlightTop, pageTop, clampPage]);

	const release = () => { anchored.current = false; };
	const onScroll = () => {
		const el = scroller.current;
		if (!el || !total) return;
		const probe = el.scrollTop + el.clientHeight * 0.35;
		let n = 1;
		for (let i = 1; i <= total; i++) if (pageTop(i) <= probe) n = i;
		if (n !== page) { setPage(n); setPageInput(String(n)); }
	};

	const zoomBy = (delta: number) => {
		anchored.current = false;
		setZoom(z => Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (z === 'fit' ? fitScale : z) + delta)) * 100) / 100);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !doc) return;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
		if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(ZOOM_STEP); }
		else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(-ZOOM_STEP); }
		else if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
		else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !target.closest('.pdf-toolbar')) {
			e.preventDefault(); goTo(page + (e.key === 'ArrowRight' ? 1 : -1));
		}
	};

	const percent = Math.round(scale * 100);
	const label = title ?? 'Document';
	return (
		<div className={`pdf-viewer pdf-viewer-${mode}`} onKeyDown={onKeyDown}>
			<div className="pdf-toolbar" role="group" aria-label="Document controls">
				{mode === 'overlay' && onClose && <Button variant="ghost" size="sm" icon={<IconArrowLeft size={16} />} onClick={onClose}>Back</Button>}
				{mode !== 'inline' && title != null && (
					<div className="pdf-title-wrap">
						<h2 className="pdf-title" ref={heading} tabIndex={-1} title={title}>{title}</h2>
						{subtitle && <p className="pdf-subtitle">{subtitle}</p>}
					</div>
				)}
				<div className="pdf-controls">
					<div className="pdf-pager">
						<IconButton size="sm" label="Previous page" icon={<IconChevronLeft size={16} />} disabled={!total || page <= 1} onClick={() => goTo(page - 1)} />
						<span className="pdf-page-input">
							<input
								aria-label="Page number"
								aria-describedby={pageInputId}
								inputMode="numeric"
								value={pageInput}
								disabled={!total}
								onChange={e => setPageInput(e.target.value.replace(/\D/g, ''))}
								onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goTo(Number(pageInput) || page); } }}
								onBlur={() => setPageInput(String(page))}
							/>
							<span id={pageInputId}><span aria-hidden="true">/ {total || '–'}</span><span className="ui-sr-only">of {total || 'unknown'} pages</span></span>
						</span>
						<IconButton size="sm" label="Next page" icon={<IconChevronRight size={16} />} disabled={!total || page >= total} onClick={() => goTo(page + 1)} />
					</div>
					<div className="pdf-zoom">
						<IconButton size="sm" label="Zoom out" shortcut="−" icon={<IconMinus size={16} />} disabled={!total || scale <= MIN_ZOOM} onClick={() => zoomBy(-ZOOM_STEP)} />
						<button
							type="button" className="pdf-zoom-label" disabled={!total}
							onClick={() => { anchored.current = false; setZoom(z => (z === 'fit' ? 1 : 'fit')); }}
							aria-label={zoom === 'fit' ? `Fit to width, ${percent} percent. Switch to actual size` : `${percent} percent. Fit to width`}
						>
							{zoom === 'fit' ? 'Fit' : `${percent}%`}
						</button>
						<IconButton size="sm" label="Zoom in" shortcut="+" icon={<IconPlus size={16} />} disabled={!total || scale >= MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)} />
					</div>
				</div>
				{mode === 'side' && onClose && <IconButton label="Close document" icon={<IconX />} onClick={onClose} side="left" />}
			</div>

			{citation && (
				<div className="pdf-quote" data-open={quoteOpen || undefined}>
					<button type="button" className="pdf-quote-toggle" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(o => !o)}>
						<span className="pdf-hl-swatch" aria-hidden="true" />
						<span>Highlighted passage · {pageLabel(citation.page_start, citation.page_end)}</span>
						<IconChevronDown size={15} className="pdf-quote-chev" />
					</button>
					{quoteOpen && (
						<div className="pdf-quote-body">
							<blockquote className="pdf-quote-text">{citation.quote}</blockquote>
							<button type="button" className="ui-link-btn pdf-quote-jump" onClick={jumpToHighlight} disabled={!doc}>Go to highlight</button>
						</div>
					)}
				</div>
			)}

			<div
				className="pdf-scroll" ref={scroller} onScroll={onScroll} tabIndex={0}
				onWheel={release} onPointerDown={release} onTouchStart={release} onKeyDownCapture={release}
				aria-label={`${label}, page ${page} of ${total || 'unknown'}`}
			>
				{error ? (
					<div className="pdf-state" role="alert">
						<p><strong>This document couldn’t be opened.</strong></p>
						{error.detail && <p className="pdf-state-detail">{error.detail}</p>}
						<p className="pdf-state-detail">{citation ? 'The highlighted passage above is still accurate.' : 'Try again, or check that the file is still in your library.'}</p>
						<Button size="sm" onClick={() => setAttempt(a => a + 1)}>Try again</Button>
					</div>
				) : !doc ? (
					<div className="pdf-pages" aria-busy="true">
						<div className="pdf-skeleton" style={{ width: Math.max(240, (width || 760) - PAD * 2), height: Math.max(240, (width || 760) - PAD * 2) * 1.29 }}>
							<span className="pdf-loading" role="status"><Spinner size={16} /> Opening the document…</span>
						</div>
					</div>
				) : (
					<div className="pdf-pages">
						{views.map((vp, i) => {
							const n = i + 1;
							const rects = reliableRects(citation, n);
							return (
								<PdfPage
									key={n} doc={doc} n={n} base={vp} scale={scale}
									boxes={rects.map(r => rectToBox(vp, scale, r))}
									fallbackQuote={!rects.length && citation?.quote && n === citation.page_start ? citation.quote : undefined}
									onFallbackMatch={setFallbackTop}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

interface Box { left: number; top: number; width: number; height: number }

function PdfPage({ doc, n, base, scale, boxes, fallbackQuote, onFallbackMatch }: {
	doc: PDFDocumentProxy; n: number; base: PageViewport; scale: number; boxes: Box[];
	fallbackQuote?: string; onFallbackMatch: (top: number | null) => void;
}) {
	const box = useRef<HTMLDivElement>(null);
	const surface = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
	const [rendered, setRendered] = useState(false);
	const [failed, setFailed] = useState(false);
	const [retry, setRetry] = useState(0);
	const w = base.width * scale, h = base.height * scale;

	useEffect(() => {
		const el = box.current;
		if (!el || typeof IntersectionObserver === 'undefined') return;
		const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: el.closest('.pdf-scroll'), rootMargin: '800px 0px' });
		io.observe(el);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		const el = box.current, target = surface.current;
		if (!el || !target) return;
		if (!visible) { target.replaceChildren(); setRendered(false); return; } // release far-off canvases
		let active = true;
		setFailed(false);
		let renderTask: import('pdfjs-dist').RenderTask | undefined;
		let textLayer: import('pdfjs-dist').TextLayer | undefined;
		void (async () => {
			const pdf = await loadPdfJs();
			const source = await doc.getPage(n);
			if (!active) return;
			const viewport = source.getViewport({ scale });
			let dpr = Math.min(window.devicePixelRatio || 1, 3);
			const area = viewport.width * viewport.height;
			if (area * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / area));
			const canvas = document.createElement('canvas');
			canvas.width = Math.floor(viewport.width * dpr);
			canvas.height = Math.floor(viewport.height * dpr);
			canvas.setAttribute('aria-hidden', 'true');
			renderTask = source.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
			await renderTask.promise;
			if (!active) return;
			const layer = document.createElement('div');
			layer.className = 'textLayer';
			textLayer = new pdf.TextLayer({ textContentSource: await source.getTextContent(), container: layer, viewport });
			await textLayer.render();
			if (!active) return;
			target.replaceChildren(canvas, layer);
			setRendered(true);
			if (fallbackQuote) {
				const group = findQuoteSpans(Array.from(layer.querySelectorAll('span')), fallbackQuote);
				const origin = el.getBoundingClientRect();
				let top: number | null = null;
				for (const span of group) {
					const r = span.getBoundingClientRect();
					const mark = document.createElement('div'); mark.className = 'pdf-hl'; mark.setAttribute('aria-hidden', 'true');
					Object.assign(mark.style, { left: `${r.left - origin.left}px`, top: `${r.top - origin.top}px`, width: `${r.width}px`, height: `${r.height}px` });
					target.append(mark);
					top = top == null ? r.top - origin.top : Math.min(top, r.top - origin.top);
				}
				onFallbackMatch(group.length ? top : null);
			}
		})().catch(() => { if (active) { target.replaceChildren(); setRendered(false); setFailed(true); } });
		return () => { active = false; renderTask?.cancel(); textLayer?.cancel(); };
	}, [visible, doc, n, scale, fallbackQuote, onFallbackMatch, retry]);

	return (
		<div ref={box} className="pdf-page" data-page={n} data-rendered={rendered || undefined} style={{ width: w, height: h, ['--scale-factor' as string]: scale }}>
			<div ref={surface} className="pdf-surface" />
			{!rendered && !failed && <span className="pdf-page-placeholder" aria-hidden="true" />}
			{failed && (
				<div className="pdf-page-error" role="alert">
					<p>Could not render page {n}.</p>
					<Button size="sm" onClick={() => setRetry(r => r + 1)}>Try again</Button>
				</div>
			)}
			{boxes.map((b, i) => (
				<span key={i} className="pdf-hl" data-highlight="rect" aria-hidden="true" style={{ left: b.left - 2, top: b.top - 1.5, width: b.width + 4, height: b.height + 3 }} />
			))}
			<span className="pdf-page-num" aria-hidden="true">{n}</span>
		</div>
	);
}
