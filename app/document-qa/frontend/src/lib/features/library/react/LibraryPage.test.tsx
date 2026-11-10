import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileReview } from '../../react-contracts';
import { AppProviders, createAppRuntime, createDefaultServices, useNavigation } from '../../../../react/providers';
import { LibraryPage } from './LibraryPage';

const reviewFixture: FileReview = {
	review_id: 'review-1',
	accepted: [{ name: 'approved.pdf', size: 1048576 }],
	rejected: [{ name: 'rejected.pdf', reason: 'The PDF is password protected.' }],
	warning: 'One file needs review.',
	requires_confirmation: true
};

const CONFIRM_LABEL = 'Add the 1 file that passed and skip 1 that can’t be added';
const ADD_BUTTON = 'Add 1 document';

type Services = ReturnType<typeof createDefaultServices>;

function setup(routed = false, configure?: (services: Services) => void) {
	const services = createDefaultServices();
	services.answering.health = vi.fn(async () => ({ ready: true } as any));
	services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
	services.settings.update = vi.fn(async value => value);
	services.history.enabled = vi.fn(async () => true);
	services.library.versions = vi.fn(async () => ({ active: 'v0001', versions: [
		{ version_id: 'v0001', status: 'active', created_at: '', document_count: 2, chunk_count: 9, documents: [] },
		{ version_id: 'v0000', status: 'retained', created_at: '', document_count: 1, chunk_count: 3, documents: [] }
	] }));
	services.library.review = vi.fn(async () => reviewFixture);
	services.library.publish = vi.fn(async () => ({ version_id: 'v0002', document_count: 1, chunk_count: 4 }));
	services.library.cancel = vi.fn(async () => true);
	services.library.status = vi.fn(async () => null);
	services.library.rollback = vi.fn(async () => ({ version_id: 'v0000' }));
	configure?.(services);
	const runtime = createAppRuntime({ ...services, createId: () => 'publication-1', now: () => 1000 }, window);
	function Route() {
		const { route } = useNavigation();
		return route.path === '/library' ? <LibraryPage /> : <p>Other page</p>;
	}
	render(<AppProviders runtime={runtime}>{routed ? <Route /> : <LibraryPage />}</AppProviders>);
	return runtime;
}

function choose(...files: File[]) {
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files } });
}

async function reviewAndConfirm() {
	choose(new File(['x'], 'brief.pdf', { type: 'application/pdf' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
}

beforeEach(() => { window.history.replaceState(null, '', '/library'); });
afterEach(cleanup);

// The redesigned Library checks chosen files straight away (one less click); the host review is unchanged.
it('sends chosen browser files as base64 for review and shows each accepted and rejected file', async () => {
	const runtime = setup();
	choose(new File(['local pdf bytes'], 'brief.pdf', { type: 'application/pdf' }));
	expect(screen.getByText('brief.pdf')).toBeTruthy();
	await waitFor(() => expect(runtime.services.library.review).toHaveBeenCalledWith([
		{ name: 'brief.pdf', data: btoa('local pdf bytes') }
	]));
	await screen.findByText('approved.pdf');
	const review = screen.getByRole('region', { name: '1 of 2 files can be added' });
	expect(within(review).getByText('Waiting for your review · not used in answers yet')).toBeTruthy();
	expect(within(review).getByText('One file needs review.')).toBeTruthy();
	expect(within(review).getByText('The PDF is password protected.')).toBeTruthy();
	expect((screen.getByRole('button', { name: ADD_BUTTON }) as HTMLButtonElement).disabled).toBe(true);
	expect(runtime.services.library.publish).not.toHaveBeenCalled();
});

it('requires rejection confirmation and publishes only after confirmation', async () => {
	const runtime = setup();
	await reviewAndConfirm();
	fireEvent.click(screen.getByRole('button', { name: ADD_BUTTON }));
	await screen.findByRole('heading', { name: 'Your library was updated' });
	expect(screen.getAllByText('Library updated · 1 PDFs · 4 passages.').length).toBeGreaterThan(0);
	expect(runtime.services.library.publish).toHaveBeenCalledWith('review-1', true, 'publication-1');
	expect(screen.getByRole('heading', { name: 'Library', level: 1 })).toBeTruthy();
});

it('shows shared busy progress and cancellation state during publication', async () => {
	let resolvePublish!: (value: { version_id: string; document_count: number; chunk_count: number }) => void;
	const runtime = setup();
	runtime.services.library.publish = vi.fn(() => new Promise(resolve => { resolvePublish = resolve; }));
	await reviewAndConfirm();
	fireEvent.click(screen.getByRole('button', { name: ADD_BUTTON }));
	await screen.findByRole('heading', { name: 'Adding 1 document' });
	expect(screen.getByText('Preparing accepted PDFs…')).toBeTruthy();
	expect(screen.getByText('0:00 elapsed')).toBeTruthy();
	expect((screen.getByRole('button', { name: 'Add PDFs' }) as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
	await waitFor(() => expect(runtime.services.library.cancel).toHaveBeenCalledWith('publication-1'));
	await screen.findByText('Cancelling safely…');
	expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
	resolvePublish({ version_id: 'v0002', document_count: 1, chunk_count: 4 });
	await screen.findByRole('heading', { name: 'Your library was updated' });
});

it('shows the coordinator\'s real error when a publication fails after cancel was requested', async () => {
	let rejectPublish!: (reason: unknown) => void;
	const runtime = setup();
	runtime.services.library.publish = vi.fn(() => new Promise((_, reject) => { rejectPublish = reject; }));
	await reviewAndConfirm();
	fireEvent.click(screen.getByRole('button', { name: ADD_BUTTON }));
	await screen.findByRole('heading', { name: 'Adding 1 document' });
	fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
	await screen.findByText('Cancelling safely…');
	rejectPublish(new Error('Disk is full.'));
	await screen.findByRole('heading', { name: 'Adding stopped' });
	expect(screen.getByText('Disk is full.')).toBeTruthy();
	expect(screen.queryByText(/Adding was cancelled/)).toBeNull();
});

it('retains a failed review so publication can be retried', async () => {
	const runtime = setup();
	await reviewAndConfirm();
	runtime.services.library.publish = vi.fn(async () => { throw new Error('Publication failed'); });
	fireEvent.click(screen.getByRole('button', { name: ADD_BUTTON }));
	await screen.findByText('Publication failed');
	expect(screen.getByRole('heading', { name: 'These files weren’t added' })).toBeTruthy();
	expect(screen.getByText('approved.pdf')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
	await waitFor(() => expect(runtime.services.library.publish).toHaveBeenCalledTimes(2));
});

it('keeps a live publication when the route unmounts and remounts', async () => {
	let resolvePublish!: (value: { version_id: string; document_count: number; chunk_count: number }) => void;
	const runtime = setup(true);
	runtime.services.library.publish = vi.fn(() => new Promise(resolve => { resolvePublish = resolve; }));
	await reviewAndConfirm();
	fireEvent.click(screen.getByRole('button', { name: ADD_BUTTON }));
	await screen.findByText('Preparing accepted PDFs…');
	runtime.navigation.navigate('/history');
	await screen.findByText('Other page');
	expect(runtime.library.getSnapshot().busy).toBe(true);
	expect(runtime.services.library.cancel).not.toHaveBeenCalled();
	runtime.navigation.navigate('/library');
	await screen.findByText('Preparing accepted PDFs…');
	expect(screen.getByText('0:00 elapsed')).toBeTruthy();
	resolvePublish({ version_id: 'v0002', document_count: 1, chunk_count: 4 });
	await screen.findByRole('heading', { name: 'Your library was updated' });
});

it('keeps a busy picker selection local until a failed publication releases the provider', async () => {
	let rejectPublish!: (error: Error) => void;
	const runtime = setup();
	runtime.services.library.publish = vi.fn(() => new Promise((_, reject) => { rejectPublish = reject; }));
	await reviewAndConfirm();
	fireEvent.click(screen.getByRole('button', { name: ADD_BUTTON }));
	await screen.findByText('Preparing accepted PDFs…');
	const replacement = new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' });
	fireEvent.change(document.getElementById('pdfs')!, { target: { files: [replacement] } });
	await new Promise(resolve => setTimeout(resolve, 20));
	expect(runtime.library.getSnapshot().selected.map(file => file.name)).toEqual(['brief.pdf']);
	rejectPublish(new Error('Publication failed'));
	await waitFor(() => expect(runtime.library.getSnapshot().selected.map(file => file.name)).toEqual(['replacement.pdf']));
	expect(await screen.findByText('replacement.pdf')).toBeTruthy();
	expect(screen.getByText('Publication failed')).toBeTruthy();
});

it('turns a PDF off through the host, keeps it previewable, and requires confirmation before deletion', async () => {
	const runtime = setup(false, services => {
		services.library.versions = vi.fn(async () => ({ active: 'v1', versions: [{ version_id: 'v1', status: 'active', created_at: '', document_count: 1, chunk_count: 2, documents: [{ document_id: 'doc1', source_filename: 'manual.pdf', display_title: 'Manual', page_count: 4, enabled: true }] }] }));
		services.library.setDocumentEnabled = vi.fn(async () => ({ enabled: false }));
		services.library.deleteDocument = vi.fn(async () => ({ deleted: true, version_id: 'v2' }));
		services.answering.fetchSource = vi.fn(async () => new ArrayBuffer(4));
	});
	await screen.findByRole('button', { name: 'Manual' });
	expect(screen.getByRole('region', { name: 'In your library' })).toBeTruthy();
	fireEvent.click(screen.getByRole('switch', { name: 'Use Manual in answers' }));
	await waitFor(() => expect(runtime.services.library.setDocumentEnabled).toHaveBeenCalledWith('v1', 'doc1', false));
	await screen.findByText('PDF is off for future answers. Preview remains available.');

	// Turned-off documents stay previewable through the shared viewer; nothing loads until the viewer asks.
	const title = screen.getByRole('button', { name: 'Manual' });
	fireEvent.click(title);
	const opened = runtime.documentViewer.getSnapshot().current;
	expect(opened?.title).toBe('Manual');
	expect(opened?.returnFocus).toBe(title);
	expect(runtime.services.answering.fetchSource).not.toHaveBeenCalled();
	await opened!.load();
	expect(runtime.services.answering.fetchSource).toHaveBeenCalledWith('doc1', 'v1');

	const more = screen.getByRole('button', { name: 'More options for Manual' });
	fireEvent.click(more);
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
	expect(runtime.services.library.deleteDocument).not.toHaveBeenCalled();
	const dialog = await screen.findByRole('alertdialog', { name: 'Delete this document?' });
	fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
	expect(runtime.services.library.deleteDocument).not.toHaveBeenCalled();
	fireEvent.click(more);
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
	fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete document' }));
	await waitFor(() => expect(runtime.services.library.deleteDocument).toHaveBeenCalledWith('v1', 'doc1', true));
});
