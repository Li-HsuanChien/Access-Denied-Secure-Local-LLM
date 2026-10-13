<script lang="ts">
	import { onMount } from 'svelte';
	import type { LibraryClient, FileReview, CollectionVersion } from './libraryClient';
	export let client: LibraryClient;
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
		if (!selected.length || busy) return;
		busy = true; error = ''; notice = ''; review = null;
		try { review = await client.review(await Promise.all(selected.map(async (file) => ({ name: file.name, data: await encode(file) })))); confirmed = false; attempted = false; }
		catch (e) { error = message(e); }
		finally { busy = false; }
	}
	async function publish() {
		if (!review || busy || (review.rejected.length && !confirmed)) return;
		busy = true; error = ''; notice = ''; requestId = crypto.randomUUID(); progress = 'Preparing accepted PDFs…'; elapsed = 0;
		attempted = true;
		const started = Date.now();
		const clock = setInterval(() => elapsed = Math.floor((Date.now() - started) / 1000), 1000);
		const poll = setInterval(async () => { try { const state = await client.status(requestId); if (state) progress = `${state.stage} · ${state.done}/${state.total}`; } catch { /* the final request supplies the actionable error */ } }, 700);
		try { const result = await client.publish(review.review_id, confirmed, requestId); notice = `Collection ${result.version_id} is active · ${result.document_count} PDFs · ${result.chunk_count} passages.`; review = null; selected = []; picker.value = ''; await refresh(); }
		catch (e) { error = message(e); }
		finally { clearInterval(poll); clearInterval(clock); busy = false; progress = ''; requestId = ''; }
	}
	async function cancel() { if (!requestId) return; progress = 'Cancelling safely…'; try { if (!(await client.cancel(requestId))) progress = 'Publication is finishing; cancellation is no longer available.'; } catch (e) { error = message(e); } }
	async function rollback() { if (busy) return; busy = true; error = ''; try { const result = await client.rollback(); notice = `Collection ${result.version_id} is active again.`; await refresh(); } catch (e) { error = message(e); } finally { busy = false; } }
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
			<input bind:this={picker} id="pdfs" type="file" accept="application/pdf,.pdf" multiple on:change={(event) => selected = Array.from(event.currentTarget.files || [])} />
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" /></svg>
			<span class="picker-title">{selected.length ? `${selected.length} file${selected.length === 1 ? '' : 's'} selected` : 'Choose PDF files'}</span>
			<span class="hint">{selected.length ? selected.map((file) => file.name).join(', ') : 'Files stay on this computer. Nothing is published until you confirm.'}</span>
		</label>
		{#if selected.length}<div class="actions"><button class="btn primary" type="button" on:click={inspect} disabled={busy}>{busy ? 'Reviewing…' : 'Review selected files'}</button></div>{/if}
	</section>

	{#if review}
		<section class="panel" aria-labelledby="review-title">
			<h2 id="review-title">Review import</h2>
			<h3>Accepted ({review.accepted.length})</h3>
			{#if review.accepted.length}
				<ul class="rows">{#each review.accepted as file}<li><span class="grow"><span class="name">{file.name}</span></span><span class="meta">{(file.size / 1048576).toFixed(1)} MiB</span></li>{/each}</ul>
			{:else}<p class="empty">No PDFs passed validation.</p>{/if}
			{#if review.rejected.length}
				<h3>Rejected ({review.rejected.length})</h3>
				<p class="message warning" role="alert">{review.warning} Review each reason before continuing.</p>
				<ul class="rows">{#each review.rejected as file}<li><span class="grow"><span class="name">{file.name}</span><span class="meta rejected">{file.reason}</span></span></li>{/each}</ul>
				<label class="check"><input type="checkbox" bind:checked={confirmed} /><span>I reviewed the rejected files and confirm publishing only the accepted PDFs.</span></label>
			{/if}
			<div class="actions"><button class="btn primary" type="button" on:click={publish} disabled={busy || !review.accepted.length || (review.rejected.length > 0 && !confirmed)}>{attempted ? 'Restart publication' : 'Publish accepted PDFs'}</button></div>
		</section>
	{/if}

	{#if busy}
		<section class="panel" role="status" aria-live="polite">
			<div class="heading"><h2>Publication in progress</h2><button class="btn" type="button" on:click={cancel} disabled={!requestId}>Cancel publication</button></div>
			<p class="hint">{progress} · {elapsed}s elapsed</p>
		</section>
	{/if}
	{#if notice}<p class="message notice" role="status">{notice}</p>{/if}
	{#if error}<p class="message error" role="alert">{error}</p>{/if}

	<section class="panel" aria-labelledby="versions-title">
		<div class="heading"><h2 id="versions-title">Collection versions</h2><button class="btn quiet" type="button" on:click={refresh}>Refresh</button></div>
		{#if versions.length}
			<ul class="rows">{#each versions as version}<li><span class="grow"><span class="name">{version.version_id}</span><span class="meta">{version.document_count} PDFs · {version.chunk_count} passages</span></span><span class="badge" class:active={version.status === 'active'}>{version.status}</span></li>{/each}</ul>
			{#if versions.length > 1}<div class="actions"><button class="btn" type="button" on:click={rollback} disabled={busy}>Roll back to previous version</button></div>{/if}
		{:else}<p class="empty">No collection has been published.</p>{/if}
	</section>
</div>

<style>
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
