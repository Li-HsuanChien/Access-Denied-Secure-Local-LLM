import type { Answer, AnsweringClient, HealthStatus } from './types';

const quote = 'The local QA library keeps each imported reference on this computer.';
const citation = {
	citation_id: 'S1', document_id: `doc_${'0'.repeat(24)}`, document_title: 'QA Reference Guide', source_filename: 'qa-reference-guide.pdf',
	page_start: 2, page_end: 2, quote,
	pages: [{ page_number: 2, page_char_start: 0, page_char_end: quote.length, highlight_rects: [], coordinates_reliable: false, page_width: 612, page_height: 792 }],
	chunk_ids: [`chk_${'0'.repeat(24)}`], char_start: 0, char_end: quote.length, text_checksum_sha256: '0'.repeat(64), evidence_type: 'text', score: 0.91, rank: 1
};

/** A deterministic adapter for component and browser QA through the public seam. */
export function createFixtureAnsweringClient({ delay = 180, degraded = false }: { delay?: number; degraded?: boolean } = {}): AnsweringClient {
	return {
		async health(): Promise<HealthStatus> {
			return { ready: !degraded, status: degraded ? 'degraded' : 'ok', api_version: 'secure-qa-dev/1',
				answering: { ready: !degraded, stub: true, error: degraded ? { code: 'model_unavailable', message: 'The local model is not ready.', hint: 'Start the local service.' } : null },
				library: { ready: true, document_count: 1, chunk_count: 3, active_version: 'fixture', embedding_model: 'fixture' } };
		},
		async ask(question, generalKnowledge = true): Promise<Answer> {
			await new Promise((resolve) => setTimeout(resolve, delay));
			const base = { schema_version: '1.0.0' as const, request_id: 'fixture-1', question, status: 'answered' as Answer['status'], evidence_mode: 'text' as const, documents: [{ text: quote, citation_ids: ['S1'] }], general_knowledge: generalKnowledge ? 'General knowledge is labeled separately from library evidence.' : null, limitations: [] as string[], citations: [citation], evidence: [], warnings: [] as Answer['warnings'], error: null as Answer['error'], model: null, collection_version: 'fixture', prompt_version: 'fixture/1', timing: { retrieval_ms: 0, generation_ms: 0, total_ms: 0, attempts: 1, prompt_tokens: null, completion_tokens: null } };
			if (/busy/i.test(question)) return { ...base, status: 'failed', documents: [], citations: [], general_knowledge: null, error: { code: 'busy', message: 'Another question is running.', hint: 'Wait for it to finish, then try again.' } };
			if (/fail/i.test(question)) return { ...base, status: 'failed', documents: [], citations: [], general_knowledge: null, error: { code: 'backend_timeout', message: 'The model took too long to answer.', hint: 'Try again.' } };
			if (/unknown|no evidence/i.test(question)) return { ...base, status: 'insufficient_evidence', evidence_mode: 'none', documents: [], citations: [], limitations: ['The fixture library has no supporting passage for this question.'] };
			if (/warning/i.test(question)) return { ...base, warnings: [{ code: 'citation_validation', message: 'Some unsupported claims were withheld after citation validation.' }] };
			return base;
		}
	};
}
