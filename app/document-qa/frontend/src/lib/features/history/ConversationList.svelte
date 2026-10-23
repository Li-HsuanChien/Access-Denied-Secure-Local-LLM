<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { createHistoryClient, type SavedConversation } from './historyClient';
	export let onSelect: () => void = () => {};
	const client = createHistoryClient();
	let rows: SavedConversation[] = [];
	let error = '';
	let revision = 0;
	async function refresh() {
		const request = ++revision;
		try {
			const result = await client.list();
			if (request === revision) { rows = result; error = ''; }
		} catch { if (request === revision) error = 'Could not load chats.'; }
	}
	async function remove(row: SavedConversation) {
		if (!window.confirm(`Delete "${row.title}" from this computer?`)) return;
		try {
			await client.remove(row.conversation_id);
			window.dispatchEvent(new Event('secure-qa-history-changed'));
			if ($page.url.pathname === `/conversation/${encodeURIComponent(row.conversation_id)}`) await goto('/');
		} catch { error = 'Could not delete this chat. Try again.'; }
	}
	onMount(() => {
		refresh();
		window.addEventListener('secure-qa-history-changed', refresh);
		return () => window.removeEventListener('secure-qa-history-changed', refresh);
	});
</script>

<section aria-label="Saved chats" class="saved-chats">
	<div class="heading"><h2>Chats</h2><button on:click={refresh} aria-label="Refresh saved chats">Refresh</button></div>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if !rows.length && !error}<p>Your saved conversations will appear here.</p>{/if}
	<ul>{#each rows as row (row.conversation_id)}
		<li>
			<a href={`/conversation/${encodeURIComponent(row.conversation_id)}`} on:click={onSelect}
				aria-current={$page.url.pathname === `/conversation/${encodeURIComponent(row.conversation_id)}` ? 'page' : undefined}
				title={row.title}>{row.title}</a>
			<button on:click={() => remove(row)} aria-label={`Delete ${row.title}`}>×</button>
		</li>
	{/each}</ul>
</section>

<style>
	.saved-chats { padding: 12px 8px; font-size: 13px; }
	.heading, li { display: flex; align-items: center; gap: 8px; }
	.heading { justify-content: space-between; margin-bottom: 8px; }
	h2 { font-weight: 600; }
	p, .heading button { color: var(--workspace-ink-muted); font-size: 12px; }
	li a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 8px; border-radius: 8px; }
	li a:hover, a[aria-current='page'] { background: var(--workspace-hover); }
	li button { padding: 6px 8px; border-radius: 6px; }
	button:focus-visible, a:focus-visible { outline: 2px solid var(--workspace-accent); }
</style>
