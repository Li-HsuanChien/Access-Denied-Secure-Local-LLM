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
		{ version_id: 'v0001', status: 'active', created_at: '', document_count: 2, chunk_count: 9 },
		{ version_id: 'v0000', status: 'retained', created_at: '', document_count: 1, chunk_count: 3 }
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

it('renders each version summary as one text node to preserve original glyph spacing', async () => {
	setup();
	const summary = await screen.findByText('2 PDFs · 9 passages');
	expect(summary.childNodes.length).toBe(1);
	expect(summary.firstChild?.nodeType).toBe(Node.TEXT_NODE);
});

it('requires rejection confirmation and publishes only after confirmation', async () => {
	const runtime = setup();
	const file = new File(['x'], 'brief.pdf', { type: 'application/pdf' });
	fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files: [file] } });
	fireEvent.click(screen.getByRole('button', { name: 'Review selected files' }));
	await screen.findByText('approved.pdf');
	fireEvent.click(screen.getByLabelText('I reviewed the rejected files and confirm publishing only the accepted PDFs.'));
	fireEvent.click(screen.getByRole('button', { name: 'Publish accepted PDFs' }));
	await screen.findByText(/Collection v0002 is active/);
	expect(runtime.services.library.publish).toHaveBeenCalledWith('review-1', true, 'publication-1');
	expect(screen.getByText('v0001')).toBeTruthy();
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
	await screen.findByText(/Collection v0002 is active/);
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

it('rolls back through the shared client and refreshes versions', async () => {
	const runtime = setup();
	await screen.findByText('v0001');
	fireEvent.click(screen.getByRole('button', { name: 'Roll back to previous version' }));
	await screen.findByText('Collection v0000 is active again.');
	expect(runtime.services.library.rollback).toHaveBeenCalledTimes(1);
	await waitFor(() => expect(runtime.services.library.versions).toHaveBeenCalledTimes(2));
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
	await screen.findByText(/Collection v0002 is active/);
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
