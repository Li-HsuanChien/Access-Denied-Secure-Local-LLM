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
<main aria-labelledby="title">
	<p class="eyebrow">LOCAL DOCUMENT COLLECTION</p><h1 id="title">Library</h1><p>Select PDFs, review every rejection, then confirm publication of the accepted remainder.</p>
	<section class="panel" aria-labelledby="select-title"><h2 id="select-title">Add PDFs</h2>	<label for="pdfs">Choose PDF files</label><input bind:this={picker} id="pdfs" type="file" accept="application/pdf,.pdf" multiple on:change={(event) => selected = Array.from(event.currentTarget.files || [])} />
	{#if selected.length}<p>{selected.length} file(s) selected</p><button type="button" on:click={inspect} disabled={busy}>{busy ? 'Reviewing…' : 'Review selected files'}</button>{/if}</section>
	{#if review}<section class="panel" aria-labelledby="review-title"><h2 id="review-title">Review import</h2><h3>Accepted ({review.accepted.length})</h3>{#if review.accepted.length}<ul>{#each review.accepted as file}<li>{file.name} <span>{(file.size / 1048576).toFixed(1)} MiB</span></li>{/each}</ul>{:else}<p>No PDFs passed validation.</p>{/if}
		{#if review.rejected.length}<h3>Rejected ({review.rejected.length})</h3><p role="alert">{review.warning} Review each reason before continuing.</p><ul class="rejected">{#each review.rejected as file}<li><strong>{file.name}</strong><span>{file.reason}</span></li>{/each}</ul><label class="confirm"><input type="checkbox" bind:checked={confirmed} /> I reviewed the rejected files and confirm publishing only the accepted PDFs.</label>{/if}
		<button type="button" on:click={publish} disabled={busy || !review.accepted.length || (review.rejected.length > 0 && !confirmed)}>{attempted ? 'Restart publication' : 'Publish accepted PDFs'}</button></section>{/if}
	{#if busy}<section class="panel" role="status" aria-live="polite"><strong>Publication in progress</strong><p>{progress} · {elapsed}s elapsed</p><button type="button" on:click={cancel} disabled={!requestId}>Cancel publication</button></section>{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}{#if error}<p class="error" role="alert">{error}</p>{/if}
	<section class="panel" aria-labelledby="versions-title"><div class="heading"><h2 id="versions-title">Collection versions</h2><button type="button" on:click={refresh}>Refresh</button></div>
	{#if versions.length}<ul>{#each versions as version}<li><strong>{version.version_id}</strong><span>{version.status} · {version.document_count} PDFs · {version.chunk_count} passages</span></li>{/each}</ul>{#if versions.length > 1}<button type="button" on:click={rollback} disabled={busy}>Roll back to previous version</button>{/if}{:else}<p>No collection has been published.</p>{/if}</section>
</main>

<style>
	main{max-width:760px;margin:48px auto;padding:0 22px;color:#24352c;font:15px/1.55 system-ui,sans-serif}.eyebrow{font-size:11px;letter-spacing:.12em;color:#47755f;font-weight:700}h1{font-size:36px;margin:.2em 0}h2{font-size:18px;margin:0 0 14px}h3{font-size:14px}.panel{background:white;border:1px solid #dce8e0;border-radius:12px;padding:20px;margin:16px 0}.panel ul{padding-left:20px}.panel li{margin:8px 0}.panel li span{color:#68766e;margin-left:8px}.rejected{color:#733f35}.rejected li span{display:block;margin:0}.confirm{display:flex;gap:9px;margin:16px 0}.heading{display:flex;justify-content:space-between}button{border:0;border-radius:8px;background:#176b50;color:white;padding:10px 14px;font-weight:650;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}input[type=file]{display:block;margin:9px 0 14px}.notice{padding:12px;background:#e9f5ee;border-radius:8px;color:#285c41}.error{color:#8b3028}.panel p{color:#5d6d63}button:focus-visible,input:focus-visible{outline:3px solid #87c3a4;outline-offset:3px}
</style>
