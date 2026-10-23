import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnsweringClient } from './answeringClient';
import { createFixtureAnsweringClient } from './fixtureAnsweringClient';

const fixture = createFixtureAnsweringClient({ delay: 0 });
const health = await fixture.health();

const jsonResponse = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('answering client', () => {
	afterEach(() => vi.restoreAllMocks());

	it('reads local host readiness', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(health));
		const client = createAnsweringClient({ baseUrl: 'http://127.0.0.1:8765', fetchImpl });

		await expect(client.health()).resolves.toMatchObject({ ready: true, library: { ready: true } });
		expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8765/health', expect.objectContaining({ method: 'GET' }));
	});

	it('sends the approved envelope and returns the workflow answer', async () => {
		const answer = { ...await fixture.ask('No evidence', false), request_id: 'qa-1' };
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'qa-1', operation: 'answering.ask', result: answer }));
		const client = createAnsweringClient({ baseUrl: 'http://localhost:8765', fetchImpl, createRequestId: () => 'qa-1' });

		await expect(client.ask('What does the library say?', false)).resolves.toEqual(answer);
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
			request_id: 'qa-1', operation: 'answering.ask',
			payload: { question: 'What does the library say?', general_knowledge: false }
		});
	});

	it('threads a conversation id into the envelope when one is given', async () => {
		const answer = { ...await fixture.ask('q', false), request_id: 'qa-1' };
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'qa-1', operation: 'answering.ask', result: answer }));
		const client = createAnsweringClient({ baseUrl: 'http://127.0.0.1:8765', fetchImpl, createRequestId: () => 'qa-1' });

		await client.ask('And for workers?', true, 'room-7');
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body).payload).toEqual({
			question: 'And for workers?', general_knowledge: true, conversation_id: 'room-7'
		});
	});

	it('fetches a cached source PDF with the document id and version in the query', async () => {
		const bytes = new TextEncoder().encode('%PDF-1.4').buffer;
		const fetchImpl = vi.fn().mockResolvedValue(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
		const client = createAnsweringClient({ baseUrl: 'http://127.0.0.1:8765', fetchImpl });

		const out = await client.fetchSource('doc_abc', 'v0003');
		expect(new Uint8Array(out)).toEqual(new Uint8Array(bytes));
		const url = fetchImpl.mock.calls[0][0];
		expect(url).toContain('/v1/source?');
		expect(url).toContain('document_id=doc_abc');
		expect(url).toContain('version=v0003');
	});

	it('surfaces an actionable error when the source is unavailable', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
		const client = createAnsweringClient({ baseUrl: 'http://127.0.0.1:8765', fetchImpl });
		await expect(client.fetchSource('doc_abc')).rejects.toMatchObject({ code: 'source_unavailable' });
	});

	it('rejects non-loopback destinations before sending a request', () => {
		expect(() => createAnsweringClient({ baseUrl: 'https://example.com' })).toThrow(/loopback/i);
	});

	it('refuses redirects for every loopback request', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(health));
		await createAnsweringClient({ fetchImpl }).health();
		expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
	});

	it('rejects an incomplete answer before the view receives it', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'qa-1', operation: 'answering.ask', result: { schema_version: '1.0.0' } }));
		await expect(createAnsweringClient({ fetchImpl, createRequestId: () => 'qa-1' }).ask('Question')).rejects.toMatchObject({ code: 'invalid_response' });
	});

	it.each(['status', 'citations', 'request_id'])('rejects a malformed answer %s', async (field) => {
		const answer = { ...await fixture.ask('Question', false), request_id: 'qa-1' };
		if (field === 'status') answer.status = 'unrecognized';
		if (field === 'citations') answer.citations = [{ citation_id: 'S1' }];
		if (field === 'request_id') answer.request_id = 'different-request';
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'qa-1', operation: 'answering.ask', result: answer }));
		await expect(createAnsweringClient({ fetchImpl, createRequestId: () => 'qa-1' }).ask('Question', false)).rejects.toMatchObject({ code: 'invalid_response' });
	});

	it('surfaces host transport errors with their actionable hint', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'busy', message: 'Another question is running', hint: 'Wait for it to finish.' } }, 409));
		const client = createAnsweringClient({ baseUrl: 'http://127.0.0.1:8765', fetchImpl });

		await expect(client.ask('Question', true)).rejects.toMatchObject({ code: 'busy', message: 'Another question is running', hint: 'Wait for it to finish.' });
	});

	it('provides deterministic fixture answers for QA states', async () => {
		const fixture = createFixtureAnsweringClient({ delay: 0 });
		await expect(fixture.ask('What is in the guide?', false)).resolves.toMatchObject({ status: 'answered', documents: [{ citation_ids: ['S1'] }], general_knowledge: null });
		await expect(fixture.ask('No evidence for this?', true)).resolves.toMatchObject({ status: 'insufficient_evidence' });
		await expect(fixture.ask('busy please', true)).resolves.toMatchObject({ status: 'failed', error: { code: 'busy' } });
	});
});
