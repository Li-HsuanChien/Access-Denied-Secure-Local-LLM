<script lang="ts">
	import { onMount } from 'svelte';
	import type { ConversationHistoryClient, SavedConversation } from './historyClient';
	export let client: ConversationHistoryClient;
	let rows: SavedConversation[] = [];
	let enabled = true;
	let selected: Record<string, unknown> | null = null;
	let error = '';
	let notice = '';
	async function refresh() { try { rows = await client.list(); enabled = await client.enabled(); } catch (e) { error = e instanceof Error ? e.message : 'History is unavailable.'; } }
	async function open(id: string) { try { selected = await client.open(id); } catch (e) { error = e instanceof Error ? e.message : 'Could not open this conversation.'; } }
	async function remove(id: string) { try { await client.remove(id); if (selected?.conversation_id === id) selected = null; notice = 'Conversation deleted.'; await refresh(); } catch (e) { error = e instanceof Error ? e.message : 'Could not delete this conversation.'; } }
	async function clear() { if (!rows.length || !window.confirm('Delete all saved conversations from this computer?')) return; try { await client.clear(); selected = null; notice = 'Saved history cleared.'; await refresh(); } catch (e) { error = e instanceof Error ? e.message : 'Could not clear saved history.'; } }
	async function persistence(event: Event) { const value = (event.currentTarget as HTMLInputElement).checked; try { enabled = await client.setEnabled(value); notice = enabled ? 'New answers will be saved.' : 'New answers will not be saved.'; } catch (e) { error = e instanceof Error ? e.message : 'Could not update history setting.'; } }
	onMount(refresh);
	$: answer = selected?.answer as Record<string, unknown> | undefined;
</script>

<svelte:head><title>History · Access Denied</title></svelte:head>
<div class="workspace-page" aria-labelledby="title">
	<p class="eyebrow">Saved on this computer</p>
	<h1 id="title">History</h1>
	<p class="lede">Saved answers retain the model and collection versions that produced them.</p>

	<section class="panel" aria-labelledby="conversations-title">
		<div class="heading"><h2 id="conversations-title">Conversations</h2><button class="btn quiet" type="button" on:click={refresh}>Refresh</button></div>
		<label class="setting"><span class="grow"><span class="name">Save new answers to local history</span></span><span class="workspace-switch"><input type="checkbox" role="switch" checked={enabled} on:change={persistence} /></span></label>
		{#if rows.length}
			<ul class="rows">{#each rows as row}
				<li class="row" class:current={selected?.conversation_id === row.conversation_id}>
					<button class="open grow" type="button" on:click={() => open(row.conversation_id)}><span class="name">{row.title}</span><span class="meta">{row.updated_at} · model {row.model_id || 'unknown'} · collection {row.collection_version || 'unknown'}</span></button>
					<button class="btn danger delete" type="button" aria-label={`Delete ${row.title}`} on:click={() => remove(row.conversation_id)}>Delete</button>
				</li>
			{/each}</ul>
			<div class="actions"><button class="btn danger" type="button" on:click={clear}>Clear all history</button></div>
		{:else}<p class="empty">No saved conversations yet.</p>{/if}
	</section>
	{#if notice}<p role="status" class="message notice">{notice}</p>{/if}
	{#if error}<p role="alert" class="message error">{error}</p>{/if}

	{#if selected && answer}
		<section class="panel" aria-labelledby="opened-title">
			<h2 id="opened-title">{selected.title}</h2>
			<p class="hint">Model {selected.model_id || 'unknown'} · Collection {selected.collection_version || 'unknown'}</p>
			<p><strong>Question:</strong> {answer.question}</p>
			{#if Array.isArray(answer.documents)}<div data-evidence-kind="document" class="evidence"><h3>From your documents</h3>{#each answer.documents as claim}<p>{claim.text} {#each claim.citation_ids || [] as id}<span class="cite">{id}</span>{/each}</p>{/each}</div>{/if}
			{#if answer.general_knowledge}<div data-evidence-kind="general" class="evidence"><h3>General model knowledge</h3><p>{answer.general_knowledge}</p></div>{/if}
			{#if Array.isArray(answer.limitations)}<div data-evidence-kind="uncertain" class="evidence"><h3>Limitations</h3><ul>{#each answer.limitations as item}<li>{item}</li>{/each}</ul></div>{/if}
		</section>
	{/if}
	{#if Array.isArray(answer?.citations)}
		<section class="panel" aria-labelledby="sources-title">
			<h2 id="sources-title">Sources</h2>
			{#each answer.citations as citation}<details><summary>{citation.document_title} · pages {citation.page_start}{#if citation.page_end !== citation.page_start}–{citation.page_end}{/if}</summary><blockquote>{citation.quote}</blockquote></details>{/each}
		</section>
	{/if}
</div>

<style>
	.panel .rows > li.row { margin: 0 -8px; border-top: 0; border-radius: var(--workspace-radius-control); padding: 8px; transition: background-color var(--workspace-motion-fast); }
	.panel .rows > li.row:hover, .panel .rows > li.row.current { background: var(--workspace-hover); }
	.open { text-align: left; cursor: pointer; }
	.open .name { color: var(--workspace-accent); }
	.open:hover .name { text-decoration: underline; text-underline-offset: 2px; }
	/* Row actions appear on hover or keyboard focus, and stay visible where there is no hover. */
	.delete { opacity: 0; }
	.rows > li:hover .delete, .rows > li:focus-within .delete { opacity: 1; }
	@media (hover: none) { .delete { opacity: 1; } }
	.evidence { padding-inline-start: var(--workspace-space-3); }
	.evidence h3 { margin-top: 0; color: var(--evidence-accent); }
	.evidence p { margin: 0 0 var(--workspace-space-2); }
	.evidence ul { margin: 0; padding-inline-start: 1.1rem; list-style: disc; }
	.cite { display: inline-block; margin-inline-start: 2px; border-radius: 4px; background: color-mix(in srgb, var(--workspace-evidence) 14%, transparent); padding: 0 5px; color: var(--workspace-evidence); font-size: 11px; font-weight: 600; }
	details { border-top: 1px solid var(--workspace-line); padding: var(--workspace-space-2) 0; }
	details:first-of-type { border-top: 0; }
	summary { border-radius: 4px; font-weight: 500; cursor: pointer; }
	summary:hover { color: var(--workspace-accent); }
	blockquote { margin: var(--workspace-space-2) 0 0; border-inline-start: 2px solid var(--workspace-line); padding-inline-start: var(--workspace-space-3); color: var(--workspace-ink-muted); font-size: 13px; }
</style>
