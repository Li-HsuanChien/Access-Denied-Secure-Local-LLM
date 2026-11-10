/*
 * SIMULATED library review. Production sends the bytes to the host's
 * `library.review` operation, which validates on the Python side. Here the
 * same rejection categories are checked in the browser with pdf.js so the
 * prototype reacts to real files. Nothing leaves this computer.
 */
import { openPdf } from './pdf';

export interface ReviewFile {
	id: string;
	name: string;
	size: number;
	status: 'checking' | 'accepted' | 'rejected';
	reason?: string;
	note?: string;
	pages?: number;
	title?: string;
	data?: ArrayBuffer;
}

const MAX_BYTES = 200 * 1024 * 1024;

function prettyTitle(name: string): string {
	const base = name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim();
	return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function reviewFile(file: { name: string; size: number; data: ArrayBuffer }, existing: Set<string>): Promise<Partial<ReviewFile>> {
	const head = new TextDecoder().decode(new Uint8Array(file.data.slice(0, 5)));
	if (!/\.pdf$/i.test(file.name) || head !== '%PDF-') return { status: 'rejected', reason: "This isn't a PDF file." };
	if (file.size > MAX_BYTES) return { status: 'rejected', reason: 'This file is larger than 200 MB.' };
	try {
		const task = await openPdf(file.data);
		const doc = await task.promise;
		let chars = 0;
		for (let n = 1; n <= Math.min(3, doc.numPages); n++) {
			const content = await (await doc.getPage(n)).getTextContent();
			chars += content.items.reduce((sum, item) => sum + ('str' in item ? item.str.trim().length : 0), 0);
		}
		const meta = await doc.getMetadata().catch(() => null);
		const pages = doc.numPages;
		await task.destroy();
		if (chars < 20) return { status: 'rejected', reason: 'Its pages are scanned images without selectable text. Text recognition isn’t supported yet.' };
		const rawTitle = (meta?.info as { Title?: string } | undefined)?.Title?.replace(/\s*\(sample\)$/, '');
		return {
			status: 'accepted',
			pages,
			title: rawTitle && rawTitle.length > 2 ? rawTitle : prettyTitle(file.name),
			note: existing.has(file.name.toLowerCase()) ? 'Replaces the copy already in your library' : undefined,
		};
	} catch (cause) {
		const name = (cause as { name?: string })?.name;
		if (name === 'PasswordException') return { status: 'rejected', reason: 'It’s password-protected. Remove the password, then add it again.' };
		return { status: 'rejected', reason: 'The file is damaged or can’t be read.' };
	}
}

/** Prototype-only: a ready-made set that shows both accepted and rejected outcomes. */
export async function sampleReviewFiles(): Promise<{ name: string; size: number; data: ArrayBuffer }[]> {
	const names = ['coolant-chemistry-procedures.pdf', 'training-records-policy.pdf', 'inspection-photos-scan.pdf', 'contractor-agreement-locked.pdf'];
	const files = await Promise.all(names.map(async name => {
		const data = await (await fetch(`./review-samples/${name}`)).arrayBuffer();
		return { name, size: data.byteLength, data };
	}));
	const notes = new TextEncoder().encode('Meeting notes (sample)').buffer as ArrayBuffer;
	return [...files, { name: 'meeting-notes.docx', size: notes.byteLength, data: notes }];
}
