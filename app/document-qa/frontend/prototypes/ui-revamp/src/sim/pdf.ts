/*
 * pdf.js loading with the same hardened options production uses in
 * PdfPreview.tsx: no eval, no system or remote fonts, no scripting.
 * The library is imported lazily so no PDF code loads until a document is opened.
 */
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

export type PdfModule = typeof import('pdfjs-dist');
let modulePromise: Promise<PdfModule> | null = null;

export function loadPdfJs(): Promise<PdfModule> {
	modulePromise ??= import('pdfjs-dist').then(pdf => {
		pdf.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
		return pdf;
	});
	return modulePromise;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentLoadingTask> {
	const pdf = await loadPdfJs();
	return pdf.getDocument({
		data: new Uint8Array(data.slice(0)),
		isEvalSupported: false,
		useSystemFonts: false,
		disableFontFace: true,
		stopAtErrors: true,
		enableXfa: false,
	});
}
