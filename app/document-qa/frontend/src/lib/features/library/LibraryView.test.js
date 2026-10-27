import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import LibraryView from './LibraryView.svelte';

vi.mock('focus-trap', () => ({ createFocusTrap: () => ({ activate() {}, deactivate() {}, pause() {}, unpause() {} }) }));

let component;
beforeEach(() => {
	Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {}, finish() {}, pause() {}, play() {}, effect: { getComputedTiming: () => ({ progress: 1 }) } }));
});
afterEach(async () => { if (component) await unmount(component); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('shows PDF filenames and opens the selected version through the source preview route', async () => {
	const fetch = vi.fn(async () => new Response('', { status: 404 }));
	vi.stubGlobal('fetch', fetch);
	component = mount(LibraryView, { target: document.body, props: { client: {
		versions: async () => ({ versions: [{ version_id: 'v0001', status: 'active', document_count: 1, chunk_count: 12,
			documents: [{ document_id: 'guide', source_filename: 'Safety guide.pdf' }] }] })
	} } });
	await tick();
	await vi.waitFor(() => expect(document.body.textContent).toContain('Safety guide.pdf'));
	expect(document.body.textContent).toContain('Knowledge Collections');
	const button = [...document.querySelectorAll('button')].find((node) => node.textContent === 'Safety guide.pdf');
	button.click();
	await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
	const url = new URL(fetch.mock.calls[0][0]);
	expect(url.pathname).toBe('/v1/source');
	expect(url.searchParams.get('version')).toBe('v0001');
	expect(url.searchParams.get('document_id')).toBe('guide');
	await vi.waitFor(() => expect(document.body.textContent).toContain('Close the preview'));
});

it('allows preview during upload review and clears review when the selection changes', async () => {
	const file = new File(['%PDF'], 'Review.pdf', { type: 'application/pdf' });
	file.arrayBuffer = vi.fn(async () => { throw new Error('Preview test'); });
	component = mount(LibraryView, { target: document.body, props: { client: {
		versions: async () => ({ versions: [] }),
		review: async () => ({ review_id: 'r', accepted: [{ name: 'Review.pdf', size: 4 }], rejected: [] })
	} } });
	await tick();
	const input = document.querySelector('input[type=file]');
	Object.defineProperty(input, 'files', { configurable: true, value: [file] });
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
	[...document.querySelectorAll('button')].find((node) => node.textContent === 'Review selected files').click();
	await vi.waitFor(() => expect(document.body.textContent).toContain('Review import'));
	[...document.querySelectorAll('button')].find((node) => node.textContent === 'Review.pdf').click();
	await vi.waitFor(() => expect(file.arrayBuffer).toHaveBeenCalledOnce());
	await vi.waitFor(() => expect(document.body.textContent).toContain('Preview test'));
	[...document.querySelectorAll('button')].find((node) => node.textContent === 'Close preview').click();
	Object.defineProperty(input, 'files', { configurable: true, value: [] });
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
	expect(document.body.textContent).not.toContain('Review import');
});

function documentClient() {
	let enabled = true;
	let deleted = false;
	const doc = { document_id: 'guide', source_filename: 'Safety guide.pdf', page_count: 3 };
	return {
		versions: vi.fn(async () => ({ versions: [{ version_id: 'v1', status: 'active', documents: deleted ? [] : [{ ...doc, enabled }] }, { version_id: 'v0', status: 'previous', documents: [{ source_filename: 'Old snapshot.pdf' }] }] })),
		setDocumentEnabled: vi.fn(async (_version, _document, value) => { enabled = value; return { enabled }; }),
		deleteDocument: vi.fn(async () => { deleted = true; return { deleted: true, version_id: 'v2' }; })
	};
}
const buttonWithText = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent === text);
async function showDocuments(client) {
	component = mount(LibraryView, { target: document.body, props: { client } });
	await tick();
	await vi.waitFor(() => expect(document.querySelector('[role=switch]')).not.toBeNull());
}
it('saves on/off changes and keeps the PDF preview available without rollback controls', async () => {
	const client = documentClient();
	await showDocuments(client);
	expect(document.body.textContent).not.toContain('Roll back');
	expect(document.body.textContent).not.toContain('Old snapshot.pdf');
	document.querySelector('[role=switch]').click();
	await vi.waitFor(() => expect(document.querySelector('[role=switch]').checked).toBe(false));
	expect(client.setDocumentEnabled).toHaveBeenCalledWith('v1', 'guide', false);
	expect(buttonWithText('Safety guide.pdf')).toBeDefined();
	await vi.waitFor(() => expect(document.querySelector('[role=switch]').disabled).toBe(false));
	document.querySelector('[role=switch]').click();
	await vi.waitFor(() => expect(document.querySelector('[role=switch]').checked).toBe(true));
	expect(client.setDocumentEnabled).toHaveBeenLastCalledWith('v1', 'guide', true);
});
it('requires confirmation to delete and allows cancellation', async () => {
	const client = documentClient();
	await showDocuments(client);
	buttonWithText('Delete').click();
	await tick();
	expect(document.body.textContent).toContain('Delete PDF?');
	expect(client.deleteDocument).not.toHaveBeenCalled();
	buttonWithText('Cancel').click();
	await tick();
	expect(client.deleteDocument).not.toHaveBeenCalled();
	expect(buttonWithText('Safety guide.pdf')).toBeDefined();
	buttonWithText('Delete').click();
	await tick();
	buttonWithText('Confirm delete').click();
	await vi.waitFor(() => expect(client.deleteDocument).toHaveBeenCalledWith('v1', 'guide', true));
	await vi.waitFor(() => expect(document.body.textContent).toContain('No PDFs in your library'));
});
it('shows a failed switch save and preserves the server state', async () => {
	const client = documentClient();
	client.setDocumentEnabled.mockRejectedValue(new Error('Another job is running'));
	await showDocuments(client);
	document.querySelector('[role=switch]').click();
	await vi.waitFor(() => expect(document.querySelector('[role=alert]').textContent).toContain('Another job is running'));
	expect(document.querySelector('[role=switch]').checked).toBe(true);
});
