import { describe, expect, it } from 'vitest';
import { formatAnswerForChat, toOpenWebUICitations } from './openWebUIChatAdapter';

const base = {
	schema_version: '1.0.0', request_id: 'test', question: 'Why?', status: 'answered',
	evidence_mode: 'text', documents: [{ text: 'Supported claim.', citation_ids: ['source-1'] }],
	general_knowledge: 'Additional context.', limitations: ['Only one source was available.'],
	citations: [{ citation_id: 'source-1', document_title: 'Manual', source_filename: 'manual.pdf', page_start: 4, page_end: 5, quote: 'Supporting text.' }],
	warnings: [{ code: 'uncertain', message: 'The table is unclear.' }], error: null
};

describe('Open WebUI answering adapter', () => {
	it('keeps evidence, citations, general knowledge, limitations, and warnings visible', () => {
		const markdown = formatAnswerForChat(base);
		expect(markdown).toContain('### From your documents');
		expect(markdown).toContain('Supported claim. [^source-1]');
		expect(markdown).toContain('### General model knowledge');
		expect(markdown).toContain('### Limitations');
		expect(markdown).toContain('The table is unclear.');
			const [source] = toOpenWebUICitations(base);
			expect(source.source.name).toBe('Manual');
			expect(source.metadata[0].name).toBe('Manual · pp. 4–5');
			expect(source.document[0]).toBe('Supporting text.');
	});

	it('labels insufficient evidence and failed workflow outcomes', () => {
		expect(formatAnswerForChat({ ...base, status: 'insufficient_evidence', documents: [], general_knowledge: null }))
			.toContain('There is not enough evidence');
		expect(formatAnswerForChat({ ...base, status: 'failed', documents: [], error: { code: 'busy', message: 'Busy', hint: 'Try later.' } }))
			.toContain('Try later.');
	});
});
