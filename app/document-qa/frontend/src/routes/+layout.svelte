<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import '../tailwind.css';
	import '../app.css';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import i18n, { initI18n } from '$lib/i18n';
	import {
		config, functions, models, secureQaGeneralKnowledge, showSidebar, skills, temporaryChatEnabled,
		tools, user, WEBUI_NAME
	} from '$lib/stores';
	import { createAnsweringClient } from '$lib/features/answering/answeringClient';
	import type { HealthStatus } from '$lib/features/answering/types';

	setContext('i18n', i18n);

	// Seed the pinned Open WebUI chat with one local model and no account/network features.
	user.set({ id: 'local-user', name: 'Local user', role: 'user', permissions: { features: {} } } as any);
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
	let generalKnowledge = true;
	const client = createAnsweringClient();

	$: secureQaGeneralKnowledge.set(generalKnowledge);

	onMount(async () => {
		await initI18n();
		await refreshHealth();
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
	<Sidebar />
	<div class="workspace">
		<div class:degraded={healthError} class="service-status" role="status" aria-live="polite">
			<span class="status-mark" aria-hidden="true"></span>
			<div><strong>{healthError ? 'Workspace needs attention' : 'Local workspace'}</strong><span>{healthMessage}</span></div>
			<label><input type="checkbox" bind:checked={generalKnowledge} /> Include general model knowledge</label>
			<button type="button" on:click={refreshHealth}>Refresh</button>
		</div>
		<main id="main-content"><slot /></main>
	</div>
</div>

<style>
	:global(html), :global(body) { height: 100%; }
	:global(body) { margin: 0; }
	.desktop-shell { display: flex; width: 100%; height: 100dvh; overflow: hidden; background: var(--background-color, #fff); color: var(--text-primary, #222); }
	.workspace { display: flex; min-width: 0; flex: 1; flex-direction: column; }
	.service-status { z-index: 20; display: flex; align-items: center; gap: 12px; min-height: 54px; border-bottom: 1px solid #e5e7eb; padding: 8px 18px; font: 12px/1.35 system-ui, sans-serif; }
	.service-status > div { display: grid; gap: 2px; flex: 1; }
	.service-status strong { font-size: 12px; }
	.service-status span { color: #667085; }
	.service-status .status-mark { width: 8px; height: 8px; border-radius: 50%; background: #2d9b6b; }
	.service-status.degraded .status-mark { background: #c98524; }
	.service-status label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
	.service-status button { border: 0; background: transparent; color: #356b53; cursor: pointer; }
	#main-content { min-height: 0; flex: 1; }
	@media (max-width: 700px) { .service-status { flex-wrap: wrap; } .service-status label { font-size: 11px; } }
</style>
