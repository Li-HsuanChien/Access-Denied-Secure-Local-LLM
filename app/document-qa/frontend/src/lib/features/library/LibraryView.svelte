<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from '$lib/components/common/Modal.svelte';
	import PDFViewer from '$lib/components/common/PDFViewer.svelte';
	import { createAnsweringClient } from '../answering/answeringClient';
	import type { LibraryClient, FileReview, CollectionVersion } from './libraryClient';
	export let client: LibraryClient;
	let previewOpen = false;
	let previewTitle = '';
	let previewData: ArrayBuffer | null = null;
	let previewError = '';
	let previewToken = 0;
	async function preview(title: string, load: () => Promise<ArrayBuffer>) {
		const token = ++previewToken;
		previewTitle = title; previewData = null; previewError = ''; previewOpen = true;
		try { const data = await load(); if (token === previewToken) previewData = data; }
		catch (e) { if (token === previewToken) previewError = message(e); }
	}
	function previewSelected(name: string) {
		const file = selected.find((file) => file.name === name);
		if (file) void preview(name, () => file.arrayBuffer());
	}
	let picker: HTMLInputElement;
	let review: FileReview | null = null;
	let versions: CollectionVersion[] = [];
	let selected: File[] = [];
	let confirmed = false;
	let busy = false;
	let requestId = '';
	let progress = '';
	let elapsed = 0;
	let error = '';
	let notice = '';
	let attempted = false;
	async function refresh() { try { versions = (await client.versions()).versions; } catch (e) { error = message(e); } }
	function message(e: unknown) { return e instanceof Error ? e.message : 'The local library request failed.'; }
	function encode(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file); }); }
	async function inspect() {
		if (!selected.length || busy || changing) return;
		busy = true; error = ''; notice = ''; review = null;
		try { review = await client.review(await Promise.all(selected.map(async (file) => ({ name: file.name, data: await encode(file) })))); confirmed = false; attempted = false; }
		catch (e) { error = message(e); }
		finally { busy = false; }
	}
	async function publish() {
		if (!review || busy || changing || (review.rejected.length && !confirmed)) return;
		busy = true; error = ''; notice = ''; requestId = crypto.randomUUID(); progress = 'Preparing accepted PDFs…'; elapsed = 0;
		attempted = true;
		const started = Date.now();
		const clock = setInterval(() => elapsed = Math.floor((Date.now() - started) / 1000), 1000);
		const poll = setInterval(async () => { try { const state = await client.status(requestId); if (state) progress = `${state.stage} · ${state.done}/${state.total}`; } catch { /* the final request supplies the actionable error */ } }, 700);
		try { const result = await client.publish(review.review_id, confirmed, requestId); notice = `Library updated · ${result.document_count} PDFs · ${result.chunk_count} passages.`; review = null; selected = []; picker.value = ''; await refresh(); }
		catch (e) { error = message(e); }
		finally { clearInterval(poll); clearInterval(clock); busy = false; progress = ''; requestId = ''; }
	}
	async function cancel() { if (!requestId) return; progress = 'Cancelling safely…'; try { if (!(await client.cancel(requestId))) progress = 'Publication is finishing; cancellation is no longer available.'; } catch (e) { error = message(e); } }
	let changing = false;
	let deleteOpen = false;
	let pendingDelete: { versionId: string; documentId: string; name: string } | null = null;
	$: currentVersion = versions.find((version) => version.status === 'active');
	async function setEnabled(versionId: string, documentId: string, enabled: boolean) {
		if (busy || changing) return;
		changing = true; error = ''; notice = '';
		try { await client.setDocumentEnabled(versionId, documentId, enabled); await refresh(); notice = enabled ? 'PDF is on for future answers.' : 'PDF is off for future answers. Preview remains available.'; }
		catch (e) { error = message(e); await refresh(); }
		finally { changing = false; }
	}
	async function deleteDocument() {
		if (!pendingDelete || busy || changing) return;
		changing = true; error = ''; notice = '';
		try { await client.deleteDocument(pendingDelete.versionId, pendingDelete.documentId, true); notice = `${pendingDelete.name} was deleted from the library.`; deleteOpen = false; pendingDelete = null; await refresh(); }
		catch (e) { error = message(e); deleteOpen = false; await refresh(); }
		finally { changing = false; }
	}
	onMount(refresh);
</script>

<svelte:head><title>Library · Access Denied</title></svelte:head>
<div class="workspace-page" aria-labelledby="title">
	<p class="eyebrow">Local document collection</p>
	<h1 id="title">Library</h1>
	<p class="lede">Select PDFs, review every rejection, then confirm publication of the accepted remainder.</p>

	<section class="panel" aria-labelledby="select-title">
		<h2 id="select-title">Add PDFs</h2>
		<label class="picker" class:has-files={selected.length > 0} for="pdfs">
			<input bind:this={picker} id="pdfs" type="file" accept="application/pdf,.pdf" multiple disabled={busy || changing} on:change={(event) => { selected = Array.from(event.currentTarget.files || []); review = null; }} />
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" /></svg>
			<span class="picker-title">{selected.length ? `${selected.length} file${selected.length === 1 ? '' : 's'} selected` : 'Choose PDF files'}</span>
			<span class="hint">{selected.length ? selected.map((file) => file.name).join(', ') : 'Files stay on this computer. Nothing is published until you confirm.'}</span>
		</label>
		{#if selected.length}<div class="actions"><button class="btn primary" type="button" on:click={inspect} disabled={busy || changing}>{busy ? 'Reviewing…' : 'Review selected files'}</button></div>{/if}
	</section>

	{#if review}
		<section class="panel" aria-labelledby="review-title">
			<h2 id="review-title">Review import</h2>
			<h3>Accepted ({review.accepted.length})</h3>
			{#if review.accepted.length}
				<ul class="rows">{#each review.accepted as file}<li><span class="grow"><button class="document-title" type="button" on:click={() => previewSelected(file.name)}>{file.name}</button></span><span class="meta">{(file.size / 1048576).toFixed(1)} MiB</span></li>{/each}</ul>
			{:else}<p class="empty">No PDFs passed validation.</p>{/if}
			{#if review.rejected.length}
				<h3>Rejected ({review.rejected.length})</h3>
				<p class="message warning" role="alert">{review.warning} Review each reason before continuing.</p>
				<ul class="rows">{#each review.rejected as file}<li><span class="grow"><span class="name">{file.name}</span><span class="meta rejected">{file.reason}</span></span></li>{/each}</ul>
				<label class="check"><input type="checkbox" bind:checked={confirmed} /><span>I reviewed the rejected files and confirm publishing only the accepted PDFs.</span></label>
			{/if}
			<div class="actions"><button class="btn primary" type="button" on:click={publish} disabled={busy || changing || !review.accepted.length || (review.rejected.length > 0 && !confirmed)}>{attempted ? 'Restart publication' : 'Publish accepted PDFs'}</button></div>
		</section>
	{/if}

	{#if busy && requestId}
		<section class="panel" role="status" aria-live="polite">
			<div class="heading"><h2>Publication in progress</h2><button class="btn" type="button" on:click={cancel} disabled={!requestId}>Cancel publication</button></div>
			<p class="hint">{progress} · {elapsed}s elapsed</p>
		</section>
	{/if}
	{#if notice}<p class="message notice" role="status">{notice}</p>{/if}
	{#if error}<p class="message error" role="alert">{error}</p>{/if}

	<section class="panel" aria-labelledby="versions-title">
		<div class="heading"><h2 id="versions-title">Knowledge Collections</h2><button class="btn quiet" type="button" on:click={refresh}>Refresh</button></div>
		<p class="hint">Uploaded PDFs stay in your library. Turn a PDF off to exclude it from future answers, or delete it to remove it.</p>
		{#if currentVersion?.documents.length}
			<ul class="rows">
				{#each currentVersion.documents as document (document.document_id)}
					<li>
						<span class="grow"><button class="document-title" type="button" on:click={() => preview(document.source_filename || document.display_title || 'PDF document', () => createAnsweringClient().fetchSource(document.document_id, currentVersion!.version_id))}>{document.source_filename || document.display_title || 'PDF document'}</button><span class="meta">{document.page_count ?? '?'} pages</span></span>
						<label class="document-switch"><input type="checkbox" role="switch" aria-label={`Use ${document.source_filename || document.display_title || 'PDF document'} in answers`} checked={document.enabled !== false} disabled={busy || changing} on:change={(event) => { const enabled = event.currentTarget.checked; event.currentTarget.checked = document.enabled !== false; setEnabled(currentVersion!.version_id, document.document_id, enabled); }} /><span>{document.enabled !== false ? 'On' : 'Off'}</span></label>
						<button class="btn" type="button" disabled={busy || changing} aria-label={`Delete ${document.source_filename || document.display_title || 'PDF document'}`} on:click={() => { pendingDelete = { versionId: currentVersion!.version_id, documentId: document.document_id, name: document.source_filename || document.display_title || 'PDF document' }; deleteOpen = true; }}>Delete</button>
					</li>
				{/each}
			</ul>
		{:else}<p class="empty">No PDFs in your library. Add PDFs above to get started.</p>{/if}
	</section>
</div>

<Modal size="lg" bind:show={previewOpen}>
	<div class="preview">
		<div class="heading"><h2>{previewTitle}</h2><button class="btn" type="button" on:click={() => { previewOpen = false; previewToken++; }}>Close preview</button></div>
		{#if previewError}<p class="message error" role="alert">{previewError} Close the preview and select the document to try again.</p>
		{:else if previewData}<PDFViewer data={previewData} />
		{:else}<p role="status">Loading PDF preview...</p>{/if}
	</div>
</Modal>

<Modal size="sm" bind:show={deleteOpen}>
	<div class="preview">
		<h2>Delete PDF?</h2>
		<p>Delete {pendingDelete?.name} and its searchable passages from this library? This cannot be undone. Saved chat text remains. Source previews for older answers may also become unavailable.</p>
		<div class="actions"><button class="btn" type="button" disabled={changing} on:click={() => { deleteOpen = false; pendingDelete = null; }}>Cancel</button><button class="btn danger" type="button" disabled={changing} on:click={deleteDocument}>{changing ? 'Deleting...' : 'Confirm delete'}</button></div>
	</div>
</Modal>

<style>
	.document-switch { display: flex; align-items: center; gap: .5rem; margin-inline: 1rem; white-space: nowrap; }
	.danger { color: var(--workspace-error); }
	.preview { padding: 1.5rem; }
	.document-title { display: block; text-align: left; color: var(--workspace-accent); text-decoration: underline; overflow-wrap: anywhere; }
	.document-title:focus-visible { outline: 2px solid var(--workspace-focus); outline-offset: 2px; }
	.picker { position: relative; display: grid; justify-items: center; gap: 2px; border: 1px dashed var(--workspace-line); border-radius: var(--workspace-radius-control); padding: var(--workspace-space-6) var(--workspace-space-4); text-align: center; cursor: pointer; transition: background-color var(--workspace-motion-fast), border-color var(--workspace-motion-fast); }
	.picker:hover, .picker:focus-within { border-color: var(--workspace-accent); background: var(--workspace-hover); }
	.picker.has-files { border-style: solid; }
	.picker:focus-within { outline: 2px solid var(--workspace-focus); outline-offset: 2px; }
	.picker input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
	.picker svg { width: 20px; height: 20px; margin-bottom: 4px; color: var(--workspace-accent); }
	.picker-title { font-weight: 500; }
	.picker .hint { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rejected { color: var(--workspace-error); }
</style>
