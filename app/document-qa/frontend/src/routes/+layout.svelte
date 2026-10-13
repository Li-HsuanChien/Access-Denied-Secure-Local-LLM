<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import '../tailwind.css';
	import '../app.css';
	import '$lib/features/personality/personality.css';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import i18n, { initI18n } from '$lib/i18n';
	import {
		config, functions, models, secureQaGeneralKnowledge, showSidebar, skills, temporaryChatEnabled,
		tools, user, WEBUI_NAME
	} from '$lib/stores';
	import { createSettingsClient } from '$lib/features/settings/settingsClient';
	import { createAnsweringClient } from '$lib/features/answering/answeringClient';
	import type { HealthStatus } from '$lib/features/answering/types';

	setContext('i18n', i18n);

	// Seed the pinned Open WebUI chat with one local model and no account/network features.
	user.set({ id: 'local-user', name: 'Local user', role: 'user', permissions: { features: {}, chat: { temporary: true, temporary_enforced: true, import: false, export: false } } } as any);
	WEBUI_NAME.set('Access Denied');
	models.set([{
		id: 'secure-qa-local', name: 'Document Assistant', owned_by: 'openai', external: false,
		info: { meta: { capabilities: { vision: false, file_upload: false, web_search: false, terminal: false } } }
	} as any]);
	config.set({
		default_models: 'secure-qa-local', default_pinned_models: '',
		features: {
			enable_direct_connections: false, enable_folders: false, enable_notes: false,
			enable_automations: false, enable_channels: false, enable_web_search: false,
			enable_image_generation: false, enable_code_interpreter: false, enable_memories: false,
			enable_tools: false, enable_skills: false, enable_file_upload: false
		}
	} as any);
	showSidebar.set(true);
	temporaryChatEnabled.set(true);
	tools.set([]);
	functions.set([]);
	skills.set([]);

	let health: HealthStatus | null = null;
	let healthMessage = 'Checking the local service…';
	let healthError = false;
	const preferences = createSettingsClient();
	let preferenceError = '';
	const client = createAnsweringClient();

	async function saveKnowledge(event: Event) {
        const value = (event.currentTarget as HTMLInputElement).checked;
        preferenceError = '';
        try { secureQaGeneralKnowledge.set((await preferences.update({ general_knowledge: value })).general_knowledge); }
        catch { preferenceError = 'Could not save this preference. Please retry.'; }
    }

	onMount(async () => {
		await initI18n();
		await refreshHealth();
		try { secureQaGeneralKnowledge.set((await preferences.read()).general_knowledge); } catch {}
	});

	async function refreshHealth() {
		healthError = false;
		try {
			health = await client.health();
			healthMessage = health.ready
				? `${health.library.document_count} documents · ${health.library.chunk_count} passages · local model ready`
				: health.answering.error?.message ?? 'The local model or library is not ready.';
			healthError = !health.ready;
		} catch (error) {
			health = null;
			healthError = true;
			healthMessage = error instanceof Error ? error.message : 'The local service is unavailable.';
		}
	}
</script>

<svelte:head>
	<title>Access Denied · Local Document Assistant</title>
	<meta name="description" content="Private, local document question answering." />
</svelte:head>

<div class="desktop-shell">
	<Sidebar localMode navigation={[{ label: 'Library', href: '/library' }, { label: 'History', href: '/history' }, { label: 'Settings', href: '/settings' }]} />
	<div class="workspace">
		<div class:degraded={healthError} class="service-status" role="status" aria-live="polite">
			<span class="status-mark" aria-hidden="true"></span>
			<div><strong>{healthError ? 'Workspace needs attention' : 'Local workspace'}</strong><span>{healthMessage}</span></div>
			<label><input type="checkbox" checked={$secureQaGeneralKnowledge} on:change={saveKnowledge} /> Include general model knowledge</label>
			<button type="button" on:click={refreshHealth}>Refresh</button>
		</div>
		{#if preferenceError}<p role="alert">{preferenceError}</p>{/if}
		<main id="main-content"><slot /></main>
	</div>
</div>

<style>
	:global(html), :global(body) { height: 100%; }
	:global(body) { margin: 0; }
	.desktop-shell { display: flex; width: 100%; height: 100dvh; overflow: hidden; background: var(--workspace-paper); color: var(--workspace-ink); }
	.workspace { display: flex; min-width: 0; flex: 1; flex-direction: column; }
	.service-status { z-index: 20; display: flex; align-items: center; gap: 12px; min-height: 54px; border-bottom: 1px solid #e5e7eb; padding: 8px 18px; font: 12px/1.35 system-ui, sans-serif; }
	.service-status > div { display: grid; gap: 2px; flex: 1; }
	.service-status strong { font-size: 12px; }
	.service-status span { color: #667085; }
	.service-status .status-mark { width: 8px; height: 8px; border-radius: 50%; background: #2d9b6b; }
	.service-status.degraded .status-mark { background: #c98524; }
	.service-status label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
	.service-status button { border: 0; background: transparent; color: #356b53; cursor: pointer; }
	#main-content { min-height: 0; flex: 1; overflow: auto; }
	@media (max-width: 700px) { .service-status { flex-wrap: wrap; } .service-status label { font-size: 11px; } }
</style>
