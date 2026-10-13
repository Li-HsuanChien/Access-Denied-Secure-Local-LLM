<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import '../tailwind.css';
	import '../app.css';
	import 'tippy.js/dist/tippy.css';
	import '$lib/features/personality/personality.css';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import i18n, { initI18n } from '$lib/i18n';
	import {
		config, functions, mobile, models, secureQaGeneralKnowledge, showSidebar, skills, temporaryChatEnabled,
		tools, user, WEBUI_NAME
	} from '$lib/stores';
	import { createSettingsClient } from '$lib/features/settings/settingsClient';
	import { createAnsweringClient } from '$lib/features/answering/answeringClient';
	import type { HealthStatus } from '$lib/features/answering/types';

	setContext('i18n', i18n);

	// Seed the pinned Open WebUI chat with one local model and no account/network features.
	user.set({ id: 'local-user', name: 'Local user', role: 'user', permissions: { features: {}, chat: { temporary: true, temporary_enforced: true, import: false, export: false, stt: false, call: false, controls: false, tts: false, continue_response: false } } } as any);
	WEBUI_NAME.set('Access Denied');
	models.set([{
		id: 'secure-qa-local', name: 'Document Assistant', owned_by: 'openai', external: false,
		info: { meta: { capabilities: { vision: false, file_upload: false, web_search: false, terminal: false } } }
	} as any]);
	config.set({
		default_models: 'secure-qa-local', default_pinned_models: '',
		default_prompt_suggestions: [
			{ title: ['Summarize the key points', 'of a document in my library'], content: 'Summarize the key points of ' },
			{ title: ['Find the exact requirement', 'and cite the page it comes from'], content: 'What do my documents require for ' },
			{ title: ['Compare two documents', 'and show where they differ'], content: 'Compare what my documents say about ' }
		],
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

	// The pinned shell reads these stores; nothing else in the local build sets them.
	const MOBILE_BREAKPOINT = 768;
	const darkQuery = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');
	function syncViewport() { mobile.set(window.innerWidth < MOBILE_BREAKPOINT); }
	function syncTheme() {
		const theme = localStorage.theme ?? 'system';
		document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && !!darkQuery?.matches));
	}
	if (typeof window !== 'undefined') { syncViewport(); syncTheme(); }

	onMount(() => {
		window.addEventListener('resize', syncViewport);
		darkQuery?.addEventListener('change', syncTheme);
		return () => {
			window.removeEventListener('resize', syncViewport);
			darkQuery?.removeEventListener('change', syncTheme);
		};
	});

	onMount(async () => {
		await initI18n();
		await refreshHealth();
		try { secureQaGeneralKnowledge.set((await preferences.read()).general_knowledge); } catch {}
	});

	const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

	async function refreshHealth() {
		healthError = false;
		try {
			health = await client.health();
			healthMessage = health.ready
				? `${count(health.library.document_count, 'document')} · ${count(health.library.chunk_count, 'passage')} · local model ready`
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

<div class="desktop-shell" class:sidebar-open={$showSidebar && !$mobile}>
	<Sidebar localMode navigation={[
		{ label: 'Library', href: '/library', icon: 'library' },
		{ label: 'History', href: '/history', icon: 'history' },
		{ label: 'Settings', href: '/settings', icon: 'settings' }
	]} />
	<div class="workspace">
		<div class:degraded={healthError} class="service-status" role="status" aria-live="polite">
			{#if $mobile}
				<button type="button" class="menu-button" aria-label="Open sidebar" on:click={() => showSidebar.set(true)}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
				</button>
			{/if}
			<span class="status-mark" aria-hidden="true"></span>
			<div class="status-text"><strong>{healthError ? 'Workspace needs attention' : 'Local workspace'}</strong><span title={healthMessage}>{healthMessage}</span></div>
			<label class="workspace-switch"><input type="checkbox" role="switch" checked={$secureQaGeneralKnowledge} on:change={saveKnowledge} /><span>Include general model knowledge</span></label>
			<button type="button" class="status-action" on:click={refreshHealth}>Refresh</button>
		</div>
		{#if preferenceError}<p class="preference-error" role="alert">{preferenceError}</p>{/if}
		<main id="main-content"><slot /></main>
	</div>
</div>

<style>
	:global(html), :global(body) { height: 100%; }
	:global(body) { margin: 0; }
	.desktop-shell { display: flex; width: 100%; height: 100dvh; overflow: hidden; background: var(--workspace-paper); color: var(--workspace-ink); }
	/* The expanded sidebar is fixed-position, so the workspace reserves its width instead of sitting underneath it. */
	.workspace { display: flex; min-width: 0; flex: 1; flex-direction: column; transition: margin-inline-start 250ms cubic-bezier(0.22, 1, 0.36, 1); }
	.sidebar-open .workspace { margin-inline-start: var(--sidebar-width); }
	.service-status { z-index: 20; display: flex; flex: none; align-items: center; gap: var(--workspace-space-3); min-height: 48px; border-bottom: 1px solid var(--workspace-line); padding: 6px var(--workspace-space-4); font-size: 12px; line-height: 1.35; }
	.status-text { display: grid; flex: 1; min-width: 0; }
	.status-text strong { font-weight: 600; }
	.status-text span { overflow: hidden; color: var(--workspace-ink-muted); text-overflow: ellipsis; white-space: nowrap; }
	.status-mark { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--workspace-evidence); box-shadow: 0 0 0 3px color-mix(in srgb, var(--workspace-evidence) 18%, transparent); }
	.degraded .status-mark { background: var(--workspace-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--workspace-warning) 18%, transparent); }
	.status-action, .menu-button { flex: none; border-radius: var(--workspace-radius-control); color: var(--workspace-accent); cursor: pointer; transition: background-color var(--workspace-motion-fast); }
	.status-action { padding: 6px 10px; font-weight: 500; }
	.menu-button { display: grid; width: 32px; height: 32px; place-items: center; color: var(--workspace-ink); }
	.menu-button svg { width: 18px; height: 18px; }
	.status-action:hover, .menu-button:hover { background: var(--workspace-hover); }
	.preference-error { margin: 0; border-bottom: 1px solid var(--workspace-error-line); background: var(--workspace-error-surface); padding: 8px var(--workspace-space-4); color: var(--workspace-error); font-size: 13px; }
	#main-content { position: relative; min-height: 0; flex: 1; overflow: auto; }
	/* The pinned chat sizes itself to the viewport and subtracts the sidebar; inside the workspace both are already accounted for. */
	#main-content :global(#chat-container) { height: 100%; max-height: 100%; max-width: 100%; }
	/* The status bar owns the mobile sidebar toggle, and the attachment menu only offers workflows this build does not support. */
	#main-content :global(#sidebar-toggle-button), #main-content :global(#input-menu-button) { display: none; }
	@media (max-width: 700px) {
		.service-status { flex-wrap: wrap; row-gap: 4px; }
		.status-text { flex-basis: 40%; }
	}
</style>
