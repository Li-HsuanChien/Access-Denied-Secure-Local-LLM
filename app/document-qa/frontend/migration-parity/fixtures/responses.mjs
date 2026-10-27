const quote = 'The local QA library keeps each imported reference on this computer.';
const citation = {
	citation_id: 'S1', document_id: `doc_${'0'.repeat(24)}`, document_title: 'QA Reference Guide',
	source_filename: 'qa-reference-guide.pdf', page_start: 2, page_end: 2, quote,
	pages: [{ page_number: 2, page_char_start: 0, page_char_end: quote.length, highlight_rects: [], coordinates_reliable: false, page_width: 612, page_height: 792 }],
	chunk_ids: [`chk_${'0'.repeat(24)}`], char_start: 0, char_end: quote.length, text_checksum_sha256: '0'.repeat(64), evidence_type: 'text', score: 0.91, rank: 1
};
const rich = `# Rich response\n\n## Overview\n\n${quote} **Bold**, *italic*, ~~removed~~, and \`inline code\`.\n\n- First item\n- Second item\n\n1. Numbered first\n2. Numbered second\n\n- [x] Reviewed\n- [ ] Pending\n\n> Quoted passage\n\n| Factor | Value |\n| --- | ---: |\n| Alpha | 12 |\n| Beta | 24 |\n\n\`\`\`python\nprint("local only")\n\`\`\`\n\n\`\`\`json\n{"ready": true}\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n A --> B\n\`\`\`\n\nInline math $x^2$ and block math:\n\n$$a^2+b^2=c^2$$\n\n[Local source](/history), [external source](https://example.invalid), and [unsafe link](javascript:alert(1)).\n\n![remote image](https://example.invalid/image.png)\n\n<iframe src="https://example.invalid/embed"></iframe>\n\n<script>window.BASELINE_XSS=true</script>`;
const rendererExtras = `\n\n## Vega probe\n\n\`\`\`vega\n{"width":140,"height":80,"data":[{"name":"table","values":[{"x":1,"y":2},{"x":2,"y":3}]}],"marks":[{"type":"rect","from":{"data":"table"},"encode":{"enter":{"x":{"value":10},"y":{"field":"y","mult":15},"width":{"value":50},"height":{"value":10},"fill":{"value":"green"}}}}]}\n\`\`\`\n\n## Vega Lite probe\n\n\`\`\`vega-lite\n{"width":140,"height":80,"data":{"values":[{"name":"A","value":3},{"name":"B","value":5}]},"mark":"bar","encoding":{"x":{"field":"name","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}\n\`\`\`\n\n:::writing{subject="Baseline note"}\n**Colon fence** body.\n:::\n\n> [!WARNING]\n> Alert body.\n\n<details>\n<summary>Expandable detail probe</summary>\n\n**Detail body** here.\n</details>`;
const long = `${rich}\n\n${`### Additional section\n\n${quote}\n\n- Supporting detail A\n- Supporting detail B\n\n| Point | Status |\n| --- | --- |\n| Evidence | Local |\n| Review | Complete |\n\n`.repeat(10)}`;

export function answerFor(request, mode = 'answer') {
	const question = request.payload.question;
	if (mode === 'failure') throw new Error('fixture transport failure');
	if (mode === 'insufficient' || /unknown|no evidence/i.test(question)) return {
		schema_version: '1.0.0', request_id: request.request_id, question, status: 'insufficient_evidence', evidence_mode: 'none', documents: [], general_knowledge: null,
		limitations: ['The fixture library has no supporting passage for this question.'], citations: [], evidence: [], warnings: [], error: null,
		model: null, collection_version: 'fixture-v1', prompt_version: 'fixture/1', timing: { retrieval_ms: 0, generation_ms: 0, total_ms: 0, attempts: 1, prompt_tokens: null, completion_tokens: null }
	};
	const text = mode === 'rich' ? `${rich}${rendererExtras}` : mode === 'long' ? long : quote;
	return {
		schema_version: '1.0.0', request_id: request.request_id, question, status: 'answered', evidence_mode: 'text',
		documents: [{ text, citation_ids: ['S1'] }], general_knowledge: request.payload.general_knowledge ? 'General knowledge is labeled separately from library evidence.' : null,
		limitations: ['Only this local collection was checked.'], citations: [citation], evidence: [], warnings: [], error: null,
		model: null, collection_version: 'fixture-v1', prompt_version: 'fixture/1', timing: { retrieval_ms: 0, generation_ms: 0, total_ms: 0, attempts: 1, prompt_tokens: null, completion_tokens: null }
	};
}

export function createFixtureState() {
	const answer = answerFor({ request_id: 'fixture-answer-1', payload: { question: 'What does the local library preserve?', general_knowledge: true } });
	return {
		generalKnowledge: true, historyEnabled: true,
		records: [{ conversation_id: 'fixture-conversation-1', title: 'What does the local library preserve?', updated_at: '2026-10-20T12:00:00.000Z', model_id: 'fixture-model', collection_version: 'fixture-v1', answer }],
		versions: [{ version_id: 'fixture-v1', status: 'active', created_at: '2026-10-20T12:00:00.000Z', document_count: 1, chunk_count: 3 }],
		publishStarted: false, mode: 'answer'
	};
}

export async function respond(state, request) {
	const { operation, payload } = request;
	let result;
	switch (operation) {
		case 'settings.get':
			if (state.mode === 'settings-failure') return { status: 503, body: { request_id: request.request_id, error: { code: 'settings_unavailable', message: 'Local settings are unavailable.', hint: 'Try again later.' } } };
			result = { general_knowledge: state.generalKnowledge }; break;
		case 'settings.update':
			if (state.mode === 'settings-failure') return { status: 503, body: { request_id: request.request_id, error: { code: 'settings_unavailable', message: 'Local settings are unavailable.', hint: 'Try again later.' } } };
			state.generalKnowledge = payload.general_knowledge; result = { general_knowledge: state.generalKnowledge }; break;
		case 'history.enabled':
			if (state.mode === 'history-loading') await new Promise(resolve => setTimeout(resolve, 3500));
			result = { enabled: state.historyEnabled }; break;
		case 'history.set_enabled': state.historyEnabled = payload.enabled; result = { enabled: state.historyEnabled }; break;
		case 'history.save':
			if (state.mode === 'history-save-failure') return { status: 503, body: { request_id: request.request_id, error: { code: 'history_unavailable', message: 'History storage is unavailable.', hint: 'Try again later.' } } };
			if (state.historyEnabled) state.records.unshift({ conversation_id: payload.conversation_id, title: payload.title, updated_at: '2026-10-20T12:00:00.000Z', model_id: 'fixture-model', collection_version: 'fixture-v1', answer: payload.answer });
			result = { saved: state.historyEnabled }; break;
		case 'history.list':
			if (state.mode === 'history-loading') await new Promise(resolve => setTimeout(resolve, 3500));
			if (state.mode === 'history-failure') return { status: 503, body: { request_id: request.request_id, error: { code: 'history_unavailable', message: 'Saved history is unavailable.', hint: 'Try again later.' } } };
			result = { conversations: state.records }; break;
		case 'history.open': result = { conversation: state.records.find(record => record.conversation_id === payload.conversation_id) ?? null }; break;
		case 'history.delete': state.records = state.records.filter(record => record.conversation_id !== payload.conversation_id); result = { deleted: true }; break;
		case 'history.clear': state.records = []; result = { cleared: true }; break;
		case 'library.versions': result = { active: state.versions.find(version => version.status === 'active')?.version_id ?? null, versions: state.versions }; break;
		case 'library.review': result = { review_id: 'fixture-review-1', accepted: [{ name: 'accepted-fixture.pdf', size: 1200 }], rejected: [{ name: 'rejected-fixture.pdf', reason: 'The file is not a readable PDF.' }], warning: 'Some files were rejected.', requires_confirmation: true }; break;
		case 'library.publish':
			if (state.mode === 'library-publishing' || state.mode === 'library-cancelable') { state.publishStarted = true; await new Promise(resolve => setTimeout(resolve, 2500)); }
			if (state.cancelled) return { status: 409, body: { request_id: request.request_id, error: { code: 'publication_cancelled', message: 'Publication was cancelled safely.', hint: 'The active collection was left unchanged.' } } };
			if (state.mode === 'library-failure') return { status: 500, body: { request_id: request.request_id, error: { code: 'publication_failed', message: 'The collection could not be published.', hint: 'The active collection is unchanged.' } } };
			if (state.versions[0]) state.versions[0].status = 'previous';
			state.versions.unshift({ version_id: 'fixture-v2', status: 'active', created_at: '2026-10-20T12:00:00.000Z', document_count: 2, chunk_count: 5 });
			result = { version_id: 'fixture-v2', document_count: 2, chunk_count: 5 }; break;
		case 'library.status': result = state.publishStarted ? { status: 'running', stage: 'embedding', done: 1, total: 2 } : null; break;
		case 'library.cancel': state.publishStarted = false; state.cancelled = true; result = { cancelled: true }; break;
		case 'library.rollback': {
			const former = state.versions.find(version => version.status === 'active');
			const previous = state.versions.find(version => version.status === 'previous');
			if (former) former.status = 'previous';
			if (previous) previous.status = 'active';
			result = { version_id: previous?.version_id ?? former?.version_id ?? 'fixture-v1' };
			break;
		}
		case 'answering.ask':
			if (state.mode === 'answer-delay') await new Promise(resolve => setTimeout(resolve, 2200));
			if (state.mode === 'failure') return { status: 503, body: { request_id: request.request_id, error: { code: 'qa_unavailable', message: 'The local QA service is unavailable.', hint: 'Try again.' } } };
			result = answerFor(request, state.mode); break;
		default: result = {};
	}
	return { status: 200, body: { request_id: request.request_id, operation, result } };
}

export function health(mode = 'answer') {
	const degraded = mode === 'degraded';
	return { ready: !degraded, status: degraded ? 'degraded' : 'ok', api_version: 'secure-qa-dev/1', answering: { ready: !degraded, stub: true, error: degraded ? { code: 'model_unavailable', message: 'The local model is unavailable.', hint: 'Start the local model, then refresh status.' } : null }, library: { ready: !degraded, document_count: 1, chunk_count: 3, active_version: 'fixture-v1', embedding_model: 'fixture' } };
}
