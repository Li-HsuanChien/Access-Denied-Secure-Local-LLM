import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Citation, Immutable } from '../../react-contracts';
import { PdfPreview, findQuoteSpans } from './PdfPreview';

/* A fake pdf.js: N pages of 612×792 points with one text span each; render resolves immediately. */
const pdfjs = vi.hoisted(() => {
	const viewport = (scale: number) => ({
		width: 612 * scale, height: 792 * scale, scale,
		clone({ scale: next }: { scale: number }) { return viewport(next); },
		// Unrotated PDF → viewport transform: (x, y) → (x·s, (792 − y)·s).
		convertToViewportRectangle([x0, y0, x1, y1]: number[]) { return [x0 * scale, (792 - y0) * scale, x1 * scale, (792 - y1) * scale]; }
	});
	const state = { pages: 3, text: ['Intro text', 'Torque the flange bolts to 40 newton metres', 'Appendix'], fail: false };
	const getDocument = vi.fn(() => ({
		promise: state.fail ? Promise.reject(new Error('Invalid PDF structure.')) : Promise.resolve({
			numPages: state.pages,
			getPage: vi.fn(async (n: number) => ({
				getViewport: ({ scale }: { scale: number }) => viewport(scale),
				render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
				getTextContent: async () => ({ n })
			}))
		}),
		destroy: vi.fn(async () => undefined)
	}));
	class TextLayer {
		private readonly container: HTMLElement; private readonly n: number;
		constructor({ container, textContentSource }: { container: HTMLElement; textContentSource: { n: number } }) { this.container = container; this.n = textContentSource.n; }
		async render() { const span = document.createElement('span'); span.textContent = state.text[this.n - 1] ?? ''; this.container.append(span); }
		cancel() {}
	}
	return { state, getDocument, TextLayer, GlobalWorkerOptions: { workerSrc: '' } };
});
vi.mock('pdfjs-dist', () => ({ getDocument: pdfjs.getDocument, TextLayer: pdfjs.TextLayer, GlobalWorkerOptions: pdfjs.GlobalWorkerOptions }));

const bytes = () => new Uint8Array([37, 80, 68, 70]).buffer;
function citation(reliable: boolean): Immutable<Citation> {
	return {
		citation_id: 'c1', document_title: 'Maintenance handbook', source_filename: 'handbook.pdf', page_start: 2, page_end: 2,
		quote: 'Torque the flange bolts to 40 newton metres.', document_id: 'd1', chunk_ids: [], char_start: 0, char_end: 10,
		text_checksum_sha256: 'x', evidence_type: 'text', score: 1, rank: 1,
		pages: [{ page_number: 2, page_char_start: 0, page_char_end: 10, highlight_rects: reliable ? [[72, 100, 300, 114]] : [], coordinates_reliable: reliable, page_width: 612, page_height: 792 }]
	};
}

let scrollTops: number[] = [];
const originalScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
beforeEach(() => {
	pdfjs.state.fail = false; pdfjs.getDocument.mockClear(); scrollTops = [];
	window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
	Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
		configurable: true,
		get(this: HTMLElement & { _top?: number }) { return this._top ?? 0; },
		set(this: HTMLElement & { _top?: number }, value: number) { this._top = value; if (this.classList.contains('pdf-scroll')) scrollTops.push(value); }
	});
});
afterEach(() => {
	cleanup();
	if (originalScrollTop) Object.defineProperty(Element.prototype, 'scrollTop', originalScrollTop);
	delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
});

it('opens with production’s hardened pdf.js options and renders every page as canvas + text layer', async () => {
	const { container } = render(<PdfPreview data={bytes()} />);
	expect(screen.getByRole('status').textContent).toContain('Opening the document…');
	await waitFor(() => expect(container.querySelectorAll('.pdf-page[data-rendered]')).toHaveLength(3));
	expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true }));
	expect(pdfjs.GlobalWorkerOptions.workerSrc).toContain('pdf.worker.min.mjs');
	expect(container.querySelector('iframe, embed, object')).toBeNull();
	expect(container.querySelectorAll('.pdf-page canvas[aria-hidden="true"]')).toHaveLength(3);
	expect(container.querySelector('.pdf-page .textLayer')?.textContent).toBe('Intro text');
	expect(screen.getByText('/ 3')).toBeTruthy();
});

it('shows the side-mode toolbar, focuses the title and closes from the Close button', async () => {
	const onClose = vi.fn();
	render(<PdfPreview load={async () => bytes()} title="Maintenance handbook" subtitle="handbook.pdf · Page 2" mode="side" onClose={onClose} />);
	const title = screen.getByRole('heading', { name: 'Maintenance handbook' });
	expect(document.activeElement).toBe(title);
	expect(screen.getByText('handbook.pdf · Page 2')).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
	fireEvent.click(screen.getByRole('button', { name: 'Close document' }));
	expect(onClose).toHaveBeenCalledTimes(1);
});

it('uses a Back button in overlay mode', async () => {
	const onClose = vi.fn();
	render(<PdfPreview load={async () => bytes()} title="Maintenance handbook" mode="overlay" onClose={onClose} />);
	expect(screen.queryByRole('button', { name: 'Close document' })).toBeNull();
	fireEvent.click(screen.getByRole('button', { name: 'Back' }));
	expect(onClose).toHaveBeenCalledTimes(1);
});

it('draws highlight_rects when coordinates are reliable and lands on the highlight instantly', async () => {
	const { container } = render(<PdfPreview data={bytes()} citation={citation(true)} title="Handbook" mode="side" />);
	await waitFor(() => expect(container.querySelectorAll('[data-highlight="rect"]')).toHaveLength(1));
	// jsdom has no layout: width falls back to 760 → fit scale (760 − 56) / 612.
	const s = (760 - 56) / 612;
	const hl = container.querySelector<HTMLElement>('[data-page="2"] [data-highlight="rect"]')!;
	expect(parseFloat(hl.style.left)).toBeCloseTo(72 * s - 2);
	expect(parseFloat(hl.style.top)).toBeCloseTo(100 * s - 1.5);
	expect(parseFloat(hl.style.width)).toBeCloseTo(228 * s + 4);
	const expected = 28 + 792 * s + 16 + 100 * s - 96;
	await waitFor(() => expect(scrollTops.at(-1)).toBeCloseTo(expected));
	expect((screen.getByRole('textbox', { name: 'Page number' }) as HTMLInputElement).value).toBe('2');
	// The text-layer fallback is not used when stored coordinates are reliable.
	expect(container.querySelectorAll('.pdf-surface .pdf-hl')).toHaveLength(0);
});

it('falls back to a text-layer quote match when coordinates are not reliable', async () => {
	const { container } = render(<PdfPreview data={bytes()} citation={citation(false)} />);
	await waitFor(() => expect(container.querySelectorAll('[data-page="2"] .pdf-surface .pdf-hl')).toHaveLength(1));
	expect(container.querySelectorAll('[data-highlight="rect"]')).toHaveLength(0);
	expect(container.querySelectorAll('[data-page="1"] .pdf-hl, [data-page="3"] .pdf-hl')).toHaveLength(0);
});

it('shows the passage as plain text in a collapsible banner with Go to highlight', async () => {
	const hostile = { ...citation(true), quote: '<img src=x onerror=alert(1)> **bold**' };
	const { container } = render(<PdfPreview data={bytes()} citation={hostile} />);
	const toggle = screen.getByRole('button', { name: /Highlighted passage · Page 2/ });
	expect(toggle.getAttribute('aria-expanded')).toBe('true');
	expect(container.querySelector('.pdf-quote-text')!.textContent).toBe('<img src=x onerror=alert(1)> **bold**');
	expect(container.querySelector('.pdf-quote img')).toBeNull();
	const jump = screen.getByRole('button', { name: 'Go to highlight' });
	await waitFor(() => expect((jump as HTMLButtonElement).disabled).toBe(false));
	fireEvent.click(toggle);
	expect(toggle.getAttribute('aria-expanded')).toBe('false');
	expect(screen.queryByRole('button', { name: 'Go to highlight' })).toBeNull();
});

it('collapses the passage by default on narrow screens', () => {
	window.matchMedia = vi.fn((query: string) => ({ matches: query === '(max-width: 640px)', addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
	render(<PdfPreview data={bytes()} citation={citation(true)} />);
	expect(screen.getByRole('button', { name: /Highlighted passage/ }).getAttribute('aria-expanded')).toBe('false');
});

it('navigates pages by buttons, the page input and arrow keys, and zooms with + − 0', async () => {
	const { container } = render(<PdfPreview data={bytes()} />);
	const input = screen.getByRole('textbox', { name: 'Page number' }) as HTMLInputElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	expect(input.value).toBe('1');
	expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
	expect(input.value).toBe('2');
	fireEvent.change(input, { target: { value: '9' } });
	fireEvent.keyDown(input, { key: 'Enter' });
	expect(input.value).toBe('3');
	expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
	const scroller = container.querySelector<HTMLElement>('.pdf-scroll')!;
	fireEvent.keyDown(scroller, { key: 'ArrowLeft' });
	expect(input.value).toBe('2');
	fireEvent.keyDown(scroller, { key: 'ArrowRight' });
	expect(input.value).toBe('3');

	const zoomLabel = () => container.querySelector('.pdf-zoom-label')!.textContent;
	expect(zoomLabel()).toBe('Fit');
	fireEvent.keyDown(scroller, { key: '+' });
	expect(zoomLabel()).toBe(`${Math.round(((760 - 56) / 612 + 0.15) * 100)}%`);
	fireEvent.keyDown(scroller, { key: '0' });
	expect(zoomLabel()).toBe('Fit');
	fireEvent.keyDown(scroller, { key: '-' });
	expect(zoomLabel()).toBe(`${Math.round(((760 - 56) / 612 - 0.15) * 100)}%`);
	fireEvent.click(screen.getByRole('button', { name: /percent\. Fit to width/ }));
	expect(zoomLabel()).toBe('Fit');
	fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
	await waitFor(() => expect(parseFloat(container.querySelector<HTMLElement>('[data-page="1"]')!.style.width)).toBeCloseTo(612 * Math.round(((760 - 56) / 612 + 0.15) * 100) / 100));
	// Shortcuts do not fire while typing in the page input.
	fireEvent.keyDown(input, { key: '0' });
	expect(zoomLabel()).not.toBe('Fit');
});

it('shows an error with Try again that keeps the quoted passage visible and reloads', async () => {
	const load = vi.fn().mockRejectedValueOnce(new Error('The source document could not be opened.')).mockResolvedValueOnce(bytes());
	const { container } = render(<PdfPreview load={load} citation={citation(true)} title="Handbook" mode="side" />);
	const alert = await screen.findByRole('alert');
	expect(alert.textContent).toContain('This document couldn’t be opened.');
	expect(alert.textContent).toContain('The source document could not be opened.');
	expect(alert.textContent).toContain('The highlighted passage above is still accurate.');
	expect(container.querySelector('.pdf-quote-text')!.textContent).toBe('Torque the flange bolts to 40 newton metres.');
	await act(async () => { fireEvent.click(within(alert).getByRole('button', { name: 'Try again' })); });
	expect(load).toHaveBeenCalledTimes(2);
	await waitFor(() => expect(container.querySelectorAll('.pdf-page')).toHaveLength(3));
	expect(screen.queryByRole('alert')).toBeNull();
});

it('reports a PDF parse failure without a citation', async () => {
	pdfjs.state.fail = true;
	render(<PdfPreview data={bytes()} />);
	const alert = await screen.findByRole('alert');
	expect(alert.textContent).toContain('Invalid PDF structure.');
	expect(alert.textContent).toContain('check that the file is still in your library');
});

it('matches the first run of text spans containing the quote’s significant words', () => {
	const spans = ['Chapter 1', 'Torque the', 'flange bolts', 'to 40 newton metres', 'Next'].map(textContent => ({ textContent }));
	expect(findQuoteSpans(spans, 'Torque the flange bolts to 40 newton metres.').map(s => s.textContent)).toEqual(['Torque the', 'flange bolts', 'to 40 newton metres']);
	expect(findQuoteSpans(spans, 'Nothing here matches')).toEqual([]);
	expect(findQuoteSpans(spans, 'a b')).toEqual([]);
});
