import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function setup(routed = false) {
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
	const runtime = createAppRuntime({ ...services, createId: () => 'publication-1', now: () => 1000 }, window);
	function Route() {
		const { route } = useNavigation();
		return route.path === '/library' ? <LibraryPage /> : <p>Other page</p>;
	}
	render(<AppProviders runtime={runtime}>{routed ? <Route /> : <LibraryPage />}</AppProviders>);
	return runtime;
}

beforeEach(() => { window.history.replaceState(null, '', '/library'); });
afterEach(cleanup);

it('renders selected filenames and sends browser files as base64 for review', async () => {
	const runtime = setup();
	const file = new File(['local pdf bytes'], 'brief.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [file] } });
	expect(screen.getByText('brief.pdf')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await waitFor(() => expect(runtime.services.library.review).toHaveBeenCalledWith([
		{ name: 'brief.pdf', data: btoa('local pdf bytes') }
	]));
	await screen.findByText('approved.pdf');
	expect(screen.getByText('One file needs review. Review each reason before continuing.')).toBeTruthy();
	expect(screen.getByText('The PDF is password protected.')).toBeTruthy();
	expect((screen.getByRole('button', { name: 'Publish accepted PDFs' }) as HTMLButtonElement).disabled).toBe(true);
});


it('requires rejection confirmation and publishes only after confirmation', async () => {
	const runtime = setup();
	const file = new File(['x'], 'brief.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [file] } });
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText('I reviewed the rejected files and confirm publishing only the accepted PDFs.'));
	fireEvent.click(screen.getByRole('button', { name: 'Publish accepted PDFs' }));
	await screen.findByText(/Library updated/);
	expect(runtime.services.library.publish).toHaveBeenCalledWith('review-1', true, 'publication-1');
	expect(screen.getByRole('heading', { name: 'Knowledge Collections' })).toBeTruthy();
});

it('shows shared busy progress and cancellation state during publication', async () => {
	let resolvePublish!: (value: { version_id: string; document_count: number; chunk_count: number }) => void;
	const runtime = setup();
	runtime.services.library.publish = vi.fn(() => new Promise(resolve => { resolvePublish = resolve; }));
	const file = new File(['x'], 'brief.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [file] } });
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText('I reviewed the rejected files and confirm publishing only the accepted PDFs.'));
	fireEvent.click(screen.getByRole('button', { name: 'Publish accepted PDFs' }));
	await screen.findByText('Publication in progress');
	expect(screen.getByText('Preparing accepted PDFs… · 0s elapsed')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Cancel publication' }));
	await waitFor(() => expect(runtime.services.library.cancel).toHaveBeenCalledWith('publication-1'));
	await waitFor(() => expect(screen.getByText('Cancelling safely… · 0s elapsed')).toBeTruthy());
	resolvePublish({ version_id: 'v0002', document_count: 1, chunk_count: 4 });
	await screen.findByText(/Library updated/);
});

it('retains a failed review for restart and uses provider route cleanup on unmount', async () => {
	const runtime = setup();
	const file = new File(['x'], 'brief.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [file] } });
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText('I reviewed the rejected files and confirm publishing only the accepted PDFs.'));
	runtime.services.library.publish = vi.fn(async () => { throw new Error('Publication failed'); });
	fireEvent.click(screen.getByRole('button', { name: 'Publish accepted PDFs' }));
	await screen.findByText('Publication failed');
	expect(screen.getByRole('button', { name: 'Restart publication' })).toBeTruthy();
});


it('keeps a live publication when the route unmounts and remounts', async () => {
	let resolvePublish!: (value: { version_id: string; document_count: number; chunk_count: number }) => void;
	const runtime = setup(true);
	runtime.services.library.publish = vi.fn(() => new Promise(resolve => { resolvePublish = resolve; }));
	const file = new File(['x'], 'brief.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [file] } });
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText('I reviewed the rejected files and confirm publishing only the accepted PDFs.'));
	fireEvent.click(screen.getByRole('button', { name: 'Publish accepted PDFs' }));
	await screen.findByText('Publication in progress');
	runtime.navigation.navigate('/history');
	await screen.findByText('Other page');
	expect(runtime.library.getSnapshot().busy).toBe(true);
	expect(runtime.services.library.cancel).not.toHaveBeenCalled();
	runtime.navigation.navigate('/library');
	await screen.findByText('Publication in progress');
	expect(screen.getByText('Preparing accepted PDFs… · 0s elapsed')).toBeTruthy();
	resolvePublish({ version_id: 'v0002', document_count: 1, chunk_count: 4 });
	await screen.findByText(/Library updated/);
});

it('keeps a busy picker selection local until a failed publication releases the provider', async () => {
	let rejectPublish!: (error: Error) => void;
	const runtime = setup();
	runtime.services.library.publish = vi.fn(() => new Promise((_, reject) => { rejectPublish = reject; }));
	const original = new File(['original'], 'original.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [original] } });
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText('I reviewed the rejected files and confirm publishing only the accepted PDFs.'));
	fireEvent.click(screen.getByRole('button', { name: 'Publish accepted PDFs' }));
	await screen.findByText('Publication in progress');
	const replacement = new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' });
	fireEvent.change(document.getElementById('pdfs')!, { target: { files: [replacement] } });
	await screen.findByText('replacement.pdf');
	expect(runtime.library.getSnapshot().selected.map(file => file.name)).toEqual(['original.pdf']);
	rejectPublish(new Error('Publication failed'));
	await screen.findByText('Publication failed');
	await waitFor(() => expect(runtime.library.getSnapshot().selected.map(file => file.name)).toEqual(['replacement.pdf']));
	expect(screen.getByText('replacement.pdf')).toBeTruthy();
});

it('turns a PDF off through the host and requires confirmation before deletion', async () => {
 const runtime = setup();
 runtime.services.library.versions = vi.fn(async () => ({ active: 'v1', versions: [{ version_id: 'v1', status: 'active', created_at: '', document_count: 1, chunk_count: 2, documents: [{ document_id: 'doc1', source_filename: 'manual.pdf', display_title: 'Manual', page_count: 4, enabled: true }] }] }));
 runtime.services.library.setDocumentEnabled = vi.fn(async () => ({ enabled: false }));
 runtime.services.library.deleteDocument = vi.fn(async () => ({ deleted: true, version_id: 'v2' }));
 fireEvent.click(screen.getByRole('button', { name: 'Refresh PDFs' }));
 await screen.findByRole('button', { name: 'manual.pdf' });
 fireEvent.click(screen.getByRole('switch', { name: 'Use manual.pdf in answers' }));
 await waitFor(() => expect(runtime.services.library.setDocumentEnabled).toHaveBeenCalledWith('v1', 'doc1', false));
 await screen.findByText('PDF is off for future answers. Preview remains available.');
 fireEvent.click(screen.getByRole('button', { name: 'Delete manual.pdf' }));
 expect(runtime.services.library.deleteDocument).not.toHaveBeenCalled();
 expect(screen.getByRole('dialog', { name: 'Delete PDF?' })).toBeTruthy();
 fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
 expect(runtime.services.library.deleteDocument).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: 'Delete manual.pdf' }));
 fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
 await waitFor(() => expect(runtime.services.library.deleteDocument).toHaveBeenCalledWith('v1', 'doc1', true));
});
