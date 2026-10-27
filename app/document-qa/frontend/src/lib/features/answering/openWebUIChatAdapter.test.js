import { describe, expect, it, vi } from 'vitest';
import { createOpenWebUIAnsweringAdapter, formatAnswerForChat, toOpenWebUICitations } from './openWebUIChatAdapter';
import { workspaceVoice } from '../personality/presentation';

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
		expect(markdown).toContain('Supported claim. [1]');
		expect(markdown).toContain('### General model knowledge');
		expect(markdown).toContain(`### ${workspaceVoice.uncertaintyLabel}`);
		expect(markdown).toContain('Only one source was available.');
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

	it('emits source locators and highlight geometry for the PDF viewer', () => {
		const answer = {
			...base,
			collection_version: 'v0003',
			citations: [{
				citation_id: 'source-1', document_id: 'doc_abc', document_title: 'Manual', source_filename: 'manual.pdf',
				page_start: 4, page_end: 4, quote: 'Supporting text.',
				pages: [{ page_number: 4, highlight_rects: [[10, 20, 110, 32]], coordinates_reliable: true, page_width: 612, page_height: 792 }]
			}]
		};
		const [out] = toOpenWebUICitations(answer);
		const meta = out.metadata[0];
		expect(meta.document_id).toBe('doc_abc');
		expect(meta.version).toBe('v0003');
		expect(meta.page).toBe(3); // 0-based
		expect(meta.highlight).toMatchObject({ page: 4, reliable: true, rects: [[10, 20, 110, 32]], quote: 'Supporting text.' });
	});

	it('passes the conversation id to the client and lets the host own persistence', async () => {
		const client = { ask: vi.fn().mockResolvedValue(base) };
		const history = { save: vi.fn().mockResolvedValue(true) };
		const adapter = createOpenWebUIAnsweringAdapter(client, history);

		const { historyWarning } = await adapter.ask('And for workers?', true, 'room-7');
		expect(client.ask).toHaveBeenCalledWith('And for workers?', true, 'room-7');
		expect(history.save).not.toHaveBeenCalled(); // backend appends the turns for a thread
		expect(historyWarning).toBeNull();
	});

	it('temporary mode sends no persistent thread and never saves a one-off answer', async () => {
        const client = { ask: vi.fn().mockResolvedValue(base) };
        const history = { save: vi.fn() };
        const result = await createOpenWebUIAnsweringAdapter(client, history).ask('Private?', true, 'saved-thread', true);
        expect(client.ask).toHaveBeenCalledWith('Private?', true, undefined);
        expect(history.save).not.toHaveBeenCalled();
        expect(result.historyWarning).toBeNull();
    });

	it('still saves one-off questions locally when there is no conversation id', async () => {
		const client = { ask: vi.fn().mockResolvedValue(base) };
		const history = { save: vi.fn().mockResolvedValue(true) };
		const adapter = createOpenWebUIAnsweringAdapter(client, history);

		await adapter.ask('Why?', true);
		expect(history.save).toHaveBeenCalledTimes(1);
	});
});
