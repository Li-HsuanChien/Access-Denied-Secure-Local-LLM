<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Answer, AnsweringClient, HealthStatus } from './types';

	export let client: AnsweringClient;

	let question = '';
	let generalKnowledge = true;
	let health: HealthStatus | null = null;
	let healthError = '';
	let answer: Answer | null = null;
	let error: string | null = null;
	let busy = false;
	let questionInput: HTMLTextAreaElement;

	function errorMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return 'The local service is unavailable. Start it and try again.';
		const hint = 'hint' in cause && typeof cause.hint === 'string' ? cause.hint : '';
		return `${cause.message} ${hint}`.trim();
	}

	onMount(() => {
		refreshHealth();
	});

	async function refreshHealth() {
		healthError = '';
		try {
			health = await client.health();
		} catch (cause) {
			health = null;
			healthError = errorMessage(cause);
		}
	}

	async function submit() {
		const prompt = question.trim();
		if (!prompt || busy || !health?.ready) return;
		busy = true;
		answer = null;
		error = null;
		try {
			answer = await client.ask(prompt, generalKnowledge);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
			await tick();
			questionInput?.focus();
		}
	}

	function citationFor(id: string) {
		return answer?.citations?.find((citation) => citation.citation_id === id);
	}
</script>

<svelte:head>
	<title>Chat · Access Denied</title>
	<meta name="description" content="Ask questions about your local document collection." />
</svelte:head>

<div class="app-frame">
	<header class="topbar">
		<a class="brand" href="/qa" aria-label="Access Denied home"><span class="brand-mark" aria-hidden="true">A</span><span>Access Denied</span></a>
		<nav aria-label="Main navigation"><a class="active" href="/qa" aria-current="page">Chat</a><span aria-disabled="true">Library</span><span aria-disabled="true">History</span><span aria-disabled="true">Settings</span></nav>
		<span class="local-tag"><span></span> LOCAL WORKSPACE</span>
	</header>

	<main>
		<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy ? 'Preparing your answer.' : error ? 'The question could not be answered.' : answer?.status === 'answered' ? 'Answer ready.' : answer?.status === 'insufficient_evidence' ? 'The library has insufficient evidence.' : answer?.status === 'failed' ? 'The answer could not be completed.' : ''}</p>
		<section class="intro" aria-labelledby="page-title">
			<p class="eyebrow">PRIVATE DOCUMENT ASSISTANT</p>
			<h1 id="page-title">Ask your library.</h1>
			<p class="lede">Answers stay on this computer and point back to their source.</p>
			<p class="qa-scope">Chat preview · Library, History, and Settings are coming later.</p>
		</section>

		<section class:degraded={!health?.ready} class="readiness" aria-label="Local service status">
			<div class="status-light" aria-hidden="true"></div>
			<div class="readiness-copy">
				<strong>{health?.ready ? 'Your workspace is ready' : 'Workspace needs attention'}</strong>
				<span role="status">{#if healthError}{healthError}{:else if health?.ready}{health.library.document_count} test documents · {health.library.chunk_count} passages · {health.answering.stub ? 'deterministic QA model' : 'local model ready'}{:else if health}{health.answering.error?.message || 'The document library or local model is not ready yet.'} {health.answering.error?.hint || 'Start the local service, then refresh status.'}{:else}Checking the local service…{/if}</span>
			</div>
			<button class="quiet-button" type="button" on:click={refreshHealth}>Refresh status</button>
		</section>

		<section class="conversation" aria-label="Question and answer">
			{#if !answer && !error && !busy}
				<div class="empty-state"><div class="spark" aria-hidden="true">✳</div><h2>Start with a question</h2><p>Ask about the documents in your local library.</p></div>
			{/if}

			{#if busy}
				<div class="progress" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Searching your library and preparing an answer…</span></div>
			{/if}

			{#if error}
				<div class="message error" role="alert"><strong>We couldn’t answer that yet.</strong><p>{error}</p><p>Your question is still here. Check the local service and try again.</p></div>
			{/if}

			{#if answer}
				<article class="answer-card">
					<div class="question-bubble"><span class="label">YOUR QUESTION</span><p>{answer.question}</p></div>
					{#if answer.status === 'failed'}
						<div class="message error" role="alert"><strong>{answer.error?.code === 'busy' ? 'Another question is running.' : 'The answer could not be completed.'}</strong><p>{answer.error?.message || 'The local workflow did not return a usable answer.'}</p>{#if answer.error?.hint}<p>{answer.error.hint}</p>{/if}</div>
					{:else if answer.status === 'insufficient_evidence'}
						<div class="message insufficient" role="status"><strong>There isn’t enough evidence in this library.</strong><p>{answer.limitations?.[0] || 'Try a more specific question or add a document that covers this topic.'}</p></div>
					{/if}
					{#if answer.documents?.length}
						<section class="answer-section"><h2><span class="section-dot document-dot"></span>From your documents</h2>
							{#each answer.documents as claim}
								<p class="claim">{claim.text}</p>
								<div class="citations" aria-label="Sources for this claim">
									{#each claim.citation_ids as id (id)}
										{@const citation = citationFor(id)}
										{#if citation}<details class="citation"><summary><span class="citation-icon" aria-hidden="true">↗</span>{citation.document_title} <span>·</span> p. {citation.page_start}{#if citation.page_end !== citation.page_start}–{citation.page_end}{/if}</summary><div class="citation-body"><span class="label">SUPPORTING PASSAGE</span><blockquote>{citation.quote}</blockquote><span class="source-name">{citation.source_filename || citation.document_title}</span></div></details>{/if}
									{/each}
								</div>
							{/each}
						</section>
					{/if}
					{#if answer.general_knowledge}
						<section class="answer-section general"><h2><span class="section-dot general-dot"></span>General model knowledge</h2><p>{answer.general_knowledge}</p><p class="disclaimer">Not verified against your documents.</p></section>
					{/if}
					{#if answer.limitations?.length}
						<section class="answer-section limitations"><h2>Limitations</h2><ul>{#each answer.limitations as item}<li>{item}</li>{/each}</ul></section>
					{/if}
					{#if answer.warnings.length}<ul class="warning" role="alert">{#each answer.warnings as warning}<li>{warning.message}</li>{/each}</ul>{/if}
				</article>
			{/if}
		</section>

		<form class="composer" on:submit|preventDefault={submit}>
			<label class="sr-only" for="question">Ask a question about your documents</label>
			<textarea id="question" bind:this={questionInput} bind:value={question} rows="2" maxlength="4000" placeholder="Ask a question about your documents…" disabled={busy || !health?.ready} on:keydown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } }}></textarea>
			<div class="composer-footer">
				<label class="toggle"><input type="checkbox" bind:checked={generalKnowledge} disabled={busy} /><span class="toggle-ui" aria-hidden="true"></span><span>Include general knowledge</span></label>
				<div class="send-group"><span class="hint">Enter to send · Shift + Enter for a new line</span><button class="send-button" type="submit" disabled={busy || !health?.ready || !question.trim()}><span>{busy ? 'Working…' : 'Ask'}</span><span aria-hidden="true">↑</span></button></div>
			</div>
		</form>
		<p class="privacy-note"><span aria-hidden="true">◈</span> Your question and documents stay on this computer.</p>
	</main>
</div>

<style>
	:global(body) { margin: 0; background: #f6f7f7; color: #1e2825; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
	:global(*) { box-sizing: border-box; }
	.app-frame { min-height: 100vh; background: radial-gradient(ellipse at 50% -25%, #e2eee8 0, transparent 58%), #f6f7f7; }
	.topbar { height: 70px; padding: 0 clamp(22px, 5vw, 76px); border-bottom: 1px solid #e1e7e3; background: rgba(250,252,250,.88); display: flex; align-items: center; gap: 42px; }
	.brand { display:flex; align-items:center; gap:11px; color:#1e2825; font-weight:700; font-size:15px; text-decoration:none; white-space:nowrap; }
	.brand-mark { display:grid; place-items:center; width:31px; height:31px; border-radius:10px; background:#167355; color:white; font-family:Georgia,serif; font-size:18px; }
	nav { display:flex; align-items:center; gap:29px; height:100%; color:#83908a; font-size:13px; }
	nav a, nav span { text-decoration:none; height:100%; display:grid; align-items:center; color:inherit; }
	nav .active { color:#176b50; border-bottom:2px solid #248467; font-weight:650; }
	.local-tag { margin-left:auto; display:flex; align-items:center; gap:8px; color:#687970; font-size:10px; letter-spacing:.12em; font-weight:700; }
	.local-tag span, .status-light { width:8px; height:8px; border-radius:50%; background:#32966e; box-shadow:0 0 0 3px #e0f1e8; }
	main { width:min(760px, calc(100% - 36px)); margin:0 auto; padding:69px 0 34px; }
	.intro { margin-bottom:27px; }
	.eyebrow,.label { color:#556e60; font-size:10px; font-weight:750; letter-spacing:.14em; }
	.eyebrow { margin:0 0 13px; }
	h1 { margin:0; font-size:clamp(31px,5vw,43px); line-height:1.12; letter-spacing:-.045em; font-weight:650; }
	.lede { color:#586961; font-size:15px; margin:12px 0 0; }
	.qa-scope { color:#596c61; font-size:11px; margin:12px 0 0; }
	.readiness { display:flex; align-items:center; gap:13px; border:1px solid #dce8e0; border-radius:12px; padding:14px 16px; background:rgba(255,255,255,.68); }
	.readiness.degraded { border-color:#eadbc4; }
	.degraded .status-light { background:#c58b35; box-shadow:0 0 0 3px #f7ecd9; }
	.readiness-copy { display:grid; gap:4px; flex:1; min-width:0; }
	.readiness-copy strong { font-size:12px; font-weight:650; }
	.readiness-copy span { font-size:11px; color:#586961; overflow-wrap:anywhere; }
	.quiet-button { border:0; background:transparent; color:#31735b; font-size:11px; font-weight:650; cursor:pointer; padding:7px; }
	.conversation { min-height:260px; }
	.empty-state { text-align:center; padding:57px 20px 46px; color:#63746a; }
	.spark { color:#39856a; font-size:26px; }
	.empty-state h2 { margin:8px 0 5px; font-size:15px; color:#37443e; font-weight:650; }
	.empty-state p { margin:0; font-size:12px; }
	.composer { border:1px solid #dce3df; border-radius:15px; background:#fff; box-shadow:0 8px 30px #2845380b; padding:16px 17px 12px; }
	textarea { width:100%; border:0; resize:vertical; min-height:52px; outline:none; color:#202b26; background:transparent; font:inherit; font-size:14px; line-height:1.6; }
	textarea::placeholder { color:#62736a; }
	.composer-footer { display:flex; justify-content:space-between; align-items:center; gap:14px; border-top:1px solid #eef1ef; padding-top:10px; }
	.toggle { display:flex; align-items:center; gap:8px; color:#5b6c63; font-size:11px; cursor:pointer; }
	.toggle input { position:absolute; opacity:0; width:1px; height:1px; }
	.toggle-ui { width:26px; height:15px; background:#cbd4ce; border-radius:20px; position:relative; transition:background .15s; }
	.toggle-ui:after { content:""; position:absolute; top:2px; left:2px; background:white; width:11px; height:11px; border-radius:50%; transition:transform .15s; }
	.toggle input:checked + .toggle-ui { background:#258061; }
	.toggle input:checked + .toggle-ui:after { transform:translateX(11px); }
	.toggle input:focus-visible + .toggle-ui { outline:3px solid #9acbb7; outline-offset:2px; }
	.send-group { display:flex; gap:12px; align-items:center; }
	.hint { color:#62736a; font-size:10px; }
	.send-button { display:flex; align-items:center; gap:15px; border:0; border-radius:9px; padding:9px 12px; background:#176b50; color:white; font:inherit; font-size:11px; font-weight:650; cursor:pointer; }
	.send-button span:last-child { font-size:15px; line-height:10px; }
	.send-button:disabled { background:#b7c6be; cursor:not-allowed; }
	.privacy-note { color:#62736a; font-size:10px; text-align:center; margin:13px 0; }
	.privacy-note span { color:#518269; margin-right:4px; }
	.answer-card { padding:10px 0 24px; }
	.question-bubble { margin:0 0 23px auto; max-width:86%; width:max-content; padding:13px 16px; border:1px solid #d9e6de; border-radius:13px 13px 3px 13px; background:#eff6f1; }
	.question-bubble p { margin:6px 0 0; font-size:14px; line-height:1.55; }
	.answer-section { border-top:1px solid #e3e9e5; padding:18px 0 16px; }
	.answer-section h2 { display:flex; align-items:center; gap:9px; margin:0 0 12px; color:#3d4a44; font-size:12px; font-weight:700; }
	.section-dot { width:8px; height:8px; border-radius:50%; background:#438b6e; }
	.general-dot { background:#7989af; }
	.claim,.answer-section.general > p:first-of-type { font-size:13px; line-height:1.7; color:#35413b; margin:0 0 10px; }
	.citations { display:flex; flex-wrap:wrap; gap:8px; margin:9px 0 16px; }
	.citation { border:1px solid #d9e5de; border-radius:8px; background:#f8fbf9; color:#32694f; font-size:11px; }
	.citation summary { padding:7px 10px; cursor:pointer; list-style:none; }
	.citation summary::-webkit-details-marker { display:none; }
	.citation summary span:not(.citation-icon) { color:#9ca9a1; padding:0 2px; }
	.citation-icon { margin-right:6px; color:#398365; }
	.citation-body { padding:12px; border-top:1px solid #e2ebe5; max-width:560px; }
	.citation-body blockquote { border-left:2px solid #69a88b; margin:8px 0; padding:2px 0 2px 10px; color:#38453e; font-size:12px; line-height:1.65; }
	.source-name { color:#60736a; font-size:10px; }
	.disclaimer { color:#5e6e83!important; font-size:10px!important; margin-top:-3px!important; }
	.limitations { color:#707c75; font-size:12px; line-height:1.6; }
	.limitations ul { padding-left:18px; }
	.warning { color:#936a2d; font-size:11px; }
	.message { border-radius:10px; padding:13px 15px; margin:0 0 18px; font-size:12px; line-height:1.55; }
	.message p { margin:5px 0 0; }
	.error { border:1px solid #efcfca; color:#7a3f37; background:#fff8f6; }
	.insufficient { border:1px solid #eadfc8; color:#705a35; background:#fffbf3; }
	.progress { display:flex; align-items:center; gap:11px; padding:24px 6px; color:#527461; font-size:12px; }
	.spinner { width:15px; height:15px; border:2px solid #d2e4d8; border-top-color:#348262; border-radius:50%; animation:spin .8s linear infinite; }
	.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
	:global(button:focus-visible), :global(a:focus-visible), summary:focus-visible, textarea:focus-visible { outline:3px solid #94cdb2; outline-offset:3px; }
	@keyframes spin { to { transform:rotate(360deg); } }
	@media (max-width:650px) { .topbar { gap:18px; padding:0 16px; height:61px; } nav { gap:14px; font-size:11px; } nav span:nth-of-type(n+2), .local-tag { display:none; } main { padding-top:47px; } .hint { display:none; } .composer-footer { align-items:flex-end; } .readiness { align-items:flex-start; } .quiet-button { white-space:nowrap; } }
</style>
