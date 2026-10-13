<script lang="ts">
	import { onMount } from 'svelte';
	import { createAnsweringClient } from '../answering/answeringClient';
	import { secureQaGeneralKnowledge } from './preferencesStore';
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
		try { const [settings, enabled, health] = await Promise.all([client.read(), history.enabled(), createAnsweringClient().health()]); generalKnowledge = settings.general_knowledge; persistence = enabled; readiness = `${health.ready ? 'Ready' : 'Needs attention'} · ${health.library.document_count} ${health.library.document_count === 1 ? 'document' : 'documents'} · ${health.answering.ready ? 'local model ready' : health.answering.error?.message || 'local model unavailable'}`; }
		catch (e) { readiness = 'The local host could not be reached.'; error = e instanceof Error ? e.message : readiness; }
	}
	async function knowledge(event: Event) { const value = (event.currentTarget as HTMLInputElement).checked; try { generalKnowledge = (await client.update({ general_knowledge: value })).general_knowledge; secureQaGeneralKnowledge.set(generalKnowledge); notice = 'General knowledge preference saved and used for new questions.'; } catch (e) { error = e instanceof Error ? e.message : 'Could not save this preference.'; } }
	async function historySetting(event: Event) { const value = (event.currentTarget as HTMLInputElement).checked; try { persistence = await history.setEnabled(value); notice = persistence ? 'New answers will be saved.' : 'New answers will not be saved.'; } catch (e) { error = e instanceof Error ? e.message : 'Could not save this preference.'; } }
	onMount(refresh);
</script>

<svelte:head><title>Settings · Access Denied</title></svelte:head>
<div class="workspace-page" aria-labelledby="title">
	<p class="eyebrow">Local preferences</p>
	<h1 id="title">Settings</h1>
	<p class="lede">These controls apply to local question answering and conversation history.</p>

	<section class="panel" aria-labelledby="answering-title">
		<h2 id="answering-title">Answering</h2>
		<label class="setting"><span class="grow"><span class="name">Include general model knowledge by default</span><span class="hint">Document answers remain evidence-grounded. General knowledge is labeled and uncited.</span></span><span class="workspace-switch"><input type="checkbox" role="switch" checked={generalKnowledge} on:change={knowledge} /></span></label>
	</section>
	<section class="panel" aria-labelledby="privacy-title">
		<h2 id="privacy-title">Privacy and history</h2>
		<label class="setting"><span class="grow"><span class="name">Save new answers to local conversation history</span><span class="hint">Saved data stays on this computer and relies on operating-system disk encryption.</span></span><span class="workspace-switch"><input type="checkbox" role="switch" checked={persistence} on:change={historySetting} /></span></label>
	</section>
	<section class="panel" aria-labelledby="readiness-title">
		<div class="heading"><h2 id="readiness-title">Local readiness</h2><button class="btn quiet" type="button" on:click={refresh}>Refresh status</button></div>
		<p class="hint" role="status">{readiness}</p>
	</section>
	{#if notice}<p role="status" class="message notice">{notice}</p>{/if}
	{#if error}<p role="alert" class="message error">{error}</p>{/if}
</div>
