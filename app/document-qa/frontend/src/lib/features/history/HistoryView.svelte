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
<main aria-labelledby="title"><p class="eyebrow">SAVED ON THIS COMPUTER</p><h1 id="title">History</h1><p>Saved answers retain the model and collection versions that produced them.</p>
	<section class="panel"><div class="heading"><h2>Conversations</h2><button type="button" on:click={refresh}>Refresh</button></div>
	<label class="toggle"><input type="checkbox" checked={enabled} on:change={persistence} /><span>Save new answers to local history</span></label>
	{#if rows.length}<ul>{#each rows as row}<li><button class="open" type="button" on:click={() => open(row.conversation_id)}>{row.title}</button><small>{row.updated_at} · model {row.model_id || 'unknown'} · collection {row.collection_version || 'unknown'}</small><button class="delete" type="button" aria-label={`Delete ${row.title}`} on:click={() => remove(row.conversation_id)}>Delete</button></li>{/each}</ul><button class="danger" type="button" on:click={clear}>Clear all history</button>{:else}<p>No saved conversations yet.</p>{/if}</section>
	{#if selected && answer}<section class="panel" aria-labelledby="opened-title"><h2 id="opened-title">{selected.title}</h2><p><strong>Question:</strong> {answer.question}</p><p><strong>Model:</strong> {selected.model_id || 'unknown'} · <strong>Collection:</strong> {selected.collection_version || 'unknown'}</p>
		{#if Array.isArray(answer.documents)}<h3>From your documents</h3>{#each answer.documents as claim}<p>{claim.text} {#each claim.citation_ids || [] as id}<span class="cite">[{id}]</span>{/each}</p>{/each}{/if}
		{#if answer.general_knowledge}<h3>General model knowledge</h3><p>{answer.general_knowledge}</p>{/if}{#if Array.isArray(answer.limitations)}<h3>Limitations</h3><ul>{#each answer.limitations as item}<li>{item}</li>{/each}</ul>{/if}</section>{/if}
		{#if Array.isArray(answer.citations)}<section class="panel"><h2>Sources</h2>{#each answer.citations as citation}<details><summary>{citation.document_title} · pages {citation.page_start}{#if citation.page_end !== citation.page_start}–{citation.page_end}{/if}</summary><blockquote>{citation.quote}</blockquote></details>{/each}</section>{/if}
	{#if notice}<p role="status" class="notice">{notice}</p>{/if}{#if error}<p role="alert" class="error">{error}</p>{/if}
</main>
<style>
	main{max-width:760px;margin:48px auto;padding:0 22px;color:#24352c;font:15px/1.55 system-ui,sans-serif}.eyebrow{font-size:11px;letter-spacing:.12em;color:#47755f;font-weight:700}h1{font-size:36px;margin:.2em 0}h2{font-size:18px;margin:0 0 14px}.panel{background:white;border:1px solid #dce8e0;border-radius:12px;padding:20px;margin:16px 0}.heading{display:flex;justify-content:space-between}.panel ul{padding-left:20px}.panel li{margin:12px 0}.open{display:block;border:0;padding:0;background:none;color:#176b50;text-align:left;font-weight:700;cursor:pointer}.panel small{display:block;color:#64756b}.delete{margin-top:4px;border:0;background:none;color:#8b4036;padding:4px 0;cursor:pointer}.danger{background:#9b453c}button:not(.open):not(.delete){border:0;border-radius:8px;background:#176b50;color:white;padding:9px 13px;cursor:pointer}.toggle{display:flex;gap:9px;align-items:center;margin:12px 0 20px}.cite{color:#39765b;font-weight:650}.notice{color:#285c41}.error{color:#8b3028}button:focus-visible,input:focus-visible{outline:3px solid #87c3a4;outline-offset:3px}
</style>
