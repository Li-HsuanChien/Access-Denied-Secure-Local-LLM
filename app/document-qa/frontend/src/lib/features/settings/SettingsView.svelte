<script lang="ts">
	import { onMount } from 'svelte';
	import type { SettingsClient } from './settingsClient';
	import type { ConversationHistoryClient } from '../history/historyClient';
	export let client: SettingsClient;
	export let history: ConversationHistoryClient;
	let generalKnowledge = true;
	let persistence = true;
	let readiness = 'Checking local host…';
	let error = '';
	let notice = '';
	async function refresh() {
		try { const [settings, enabled, health] = await Promise.all([client.read(), history.enabled(), fetch('http://127.0.0.1:8765/health', { cache: 'no-store', credentials: 'omit' }).then((r) => r.json())]); generalKnowledge = settings.general_knowledge; persistence = enabled; readiness = `${health.ready ? 'Ready' : 'Needs attention'} · ${health.library.document_count} documents · ${health.answering.ready ? 'local model ready' : health.answering.error?.message || 'local model unavailable'}`; }
		catch (e) { readiness = 'The local host could not be reached.'; error = e instanceof Error ? e.message : readiness; }
	}
	async function knowledge(event: Event) { const value = (event.currentTarget as HTMLInputElement).checked; try { generalKnowledge = (await client.update({ general_knowledge: value })).general_knowledge; notice = 'General knowledge preference saved and used for new questions.'; } catch (e) { error = e instanceof Error ? e.message : 'Could not save this preference.'; } }
	async function historySetting(event: Event) { const value = (event.currentTarget as HTMLInputElement).checked; try { persistence = await history.setEnabled(value); notice = persistence ? 'New answers will be saved.' : 'New answers will not be saved.'; } catch (e) { error = e instanceof Error ? e.message : 'Could not save this preference.'; } }
	onMount(refresh);
</script>

<svelte:head><title>Settings · Access Denied</title></svelte:head>
<main aria-labelledby="title"><p class="eyebrow">LOCAL PREFERENCES</p><h1 id="title">Settings</h1><p>These controls apply to local question answering and conversation history.</p>
	<section class="panel"><h2>Answering</h2><label><input type="checkbox" checked={generalKnowledge} on:change={knowledge} /> Include general model knowledge by default</label><p>Document answers remain evidence-grounded. General knowledge is labeled and uncited.</p></section>
	<section class="panel"><h2>Privacy and history</h2><label><input type="checkbox" checked={persistence} on:change={historySetting} /> Save new answers to local conversation history</label><p>Saved data stays on this computer and relies on operating-system disk encryption.</p></section>
	<section class="panel" aria-labelledby="readiness-title"><div class="heading"><h2 id="readiness-title">Local readiness</h2><button type="button" on:click={refresh}>Refresh status</button></div><p role="status">{readiness}</p></section>
	{#if notice}<p role="status" class="notice">{notice}</p>{/if}{#if error}<p role="alert" class="error">{error}</p>{/if}
</main>
<style>
	main{max-width:760px;margin:48px auto;padding:0 22px;color:#24352c;font:15px/1.55 system-ui,sans-serif}.eyebrow{font-size:11px;letter-spacing:.12em;color:#47755f;font-weight:700}h1{font-size:36px;margin:.2em 0}h2{font-size:18px;margin:0 0 14px}.panel{background:white;border:1px solid #dce8e0;border-radius:12px;padding:20px;margin:16px 0}.panel label{display:flex;gap:10px;align-items:center;font-weight:650}.panel p{color:#5e7065;font-size:13px}.heading{display:flex;justify-content:space-between}.heading h2{margin:0}button{border:0;border-radius:8px;background:#176b50;color:white;padding:9px 13px;cursor:pointer}.notice{color:#285c41}.error{color:#8b3028}button:focus-visible,input:focus-visible{outline:3px solid #87c3a4;outline-offset:3px}
</style>
