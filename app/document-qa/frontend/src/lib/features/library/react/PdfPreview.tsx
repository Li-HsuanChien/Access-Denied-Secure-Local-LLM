import { useEffect, useRef, useState } from 'react';
import type { Citation, Immutable } from '../../react-contracts';
import './PdfPreview.css';

/** All PDF bytes come from a local file or the validated loopback source client. */
export function PdfPreview({ data, citation }: { data: ArrayBuffer; citation?: Immutable<Citation> }) {
 const [page, setPage] = useState(citation?.page_start ?? 1);
 const [count, setCount] = useState(0);
 const [zoom, setZoom] = useState(1);
 const [error, setError] = useState('');
 const root = useRef<HTMLDivElement>(null);
 const documentRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
 const [loaded, setLoaded] = useState(0);
 useEffect(() => {
  let active = true;
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  setError(''); setCount(0); setPage(citation?.page_start ?? 1);
  void import('pdfjs-dist').then(async pdf => {
   if (!active) return;
   pdf.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
   task = pdf.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
   const doc = await task.promise;
   if (!active) return;
   documentRef.current = doc; setCount(doc.numPages); setLoaded(n => n + 1);
  }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not render this PDF.'); });
  return () => { active = false; documentRef.current = null; if (task) void task.destroy(); };
 }, [data, citation]);
 useEffect(() => {
  const doc = documentRef.current, container = root.current;
  if (!doc || !container) return;
  let active = true;
  let renderTask: import('pdfjs-dist').RenderTask | undefined;
  let textLayer: import('pdfjs-dist').TextLayer | undefined;
  container.replaceChildren();
  void (async () => {
   const pdf = await import('pdfjs-dist');
   const source = await doc.getPage(page);
   if (!active) return;
   const natural = source.getViewport({ scale: 1 });
   const scale = Math.min(1, (container.clientWidth || 760) / natural.width) * zoom;
   const viewport = source.getViewport({ scale });
   const wrapper = document.createElement('div'); wrapper.className = 'pdf-page';
   wrapper.style.setProperty('--scale-factor', String(scale));
   wrapper.style.width = `${viewport.width}px`; wrapper.style.height = `${viewport.height}px`;
   const canvas = document.createElement('canvas');
   canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
   canvas.setAttribute('aria-label', `PDF page ${page}`); wrapper.append(canvas); container.append(wrapper);
   renderTask = source.render({ canvas, viewport });
   await renderTask.promise;
   if (!active) return;
   const layer = document.createElement('div'); layer.className = 'textLayer'; wrapper.append(layer);
   textLayer = new pdf.TextLayer({ textContentSource: await source.getTextContent(), container: layer, viewport });
   await textLayer.render();
   if (!active) return;
   const evidence = citation?.pages.find(p => p.page_number === page);
   if (evidence?.coordinates_reliable && evidence.highlight_rects.length) {
    for (const rect of evidence.highlight_rects) {
     const [x0, y0, x1, y1] = viewport.convertToViewportRectangle([rect[0], natural.height - rect[1], rect[2], natural.height - rect[3]]);
     const highlight = document.createElement('div'); highlight.className = 'pdf-citation-highlight';
     Object.assign(highlight.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
     wrapper.append(highlight);
    }
   } else if (citation?.quote && page === citation.page_start) {
    const words = citation.quote.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(word => word.length > 2).slice(0, 6);
    const spans = Array.from(layer.querySelectorAll('span'));
    for (let i = 0; words.length && i < spans.length; i++) {
     if (!(spans[i].textContent ?? '').toLowerCase().includes(words[0])) continue;
     const group: HTMLElement[] = []; let combined = '';
     for (let j = i; j < Math.min(spans.length, i + 40); j++) {
      group.push(spans[j]); combined += ` ${spans[j].textContent ?? ''}`;
      if (!words.every(word => combined.toLowerCase().includes(word))) continue;
      const origin = wrapper.getBoundingClientRect();
      for (const span of group) {
       const box = span.getBoundingClientRect();
       const highlight = document.createElement('div'); highlight.className = 'pdf-citation-highlight';
       Object.assign(highlight.style, { left: `${box.left - origin.left}px`, top: `${box.top - origin.top}px`, width: `${box.width}px`, height: `${box.height}px` }); wrapper.append(highlight);
      }
      return;
     }
    }
   }
  })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not render this page.'); });
  return () => { active = false; renderTask?.cancel(); textLayer?.cancel(); container.replaceChildren(); };
 }, [page, zoom, loaded, citation]);
 return <div className="pdf-preview">
  <div className="pdf-toolbar">
   <button type="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous page</button>
   <label>Page <input aria-label="PDF page" type="number" min={1} max={count || 1} value={page} onChange={e => setPage(Math.max(1, Math.min(count || 1, Number(e.target.value) || 1)))} /></label><span>of {count || '…'}</span>
   <button type="button" disabled={page >= count} onClick={() => setPage(n => n + 1)}>Next page</button>
   <button type="button" aria-label="Zoom out" onClick={() => setZoom(n => Math.max(.5, n - .25))}>−</button>
   <button type="button" aria-label="Zoom in" onClick={() => setZoom(n => Math.min(3, n + .25))}>+</button>
  </div>
  {error && <p role="alert">{error} Close the preview and select the document to try again.</p>}
  {!count && !error && <p role="status">Loading PDF…</p>}
  <div className="pdf-pages" ref={root} />
 </div>;
}
