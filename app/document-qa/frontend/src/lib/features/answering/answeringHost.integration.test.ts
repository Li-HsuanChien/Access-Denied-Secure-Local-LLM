import { describe, expect, it } from 'vitest';
import { createAnsweringClient } from './answeringClient';

// Never fall back to a developer's live 8765 service. Start the disposable fake
// host on 8766 and opt in with SECURE_QA_TEST_HOST_URL=http://127.0.0.1:8766.
const baseUrl = process.env.SECURE_QA_TEST_HOST_URL;
if (baseUrl && baseUrl !== 'http://127.0.0.1:8766') {
	throw new Error('Host integration tests require the explicit disposable http://127.0.0.1:8766 endpoint.');
}
describe.skipIf(!baseUrl)('isolated deterministic Python host', () => {
const client = baseUrl ? createAnsweringClient({ baseUrl }) : null;
it('reads the seeded host and returns a citation-bearing answer through the public client', async () => {
	const health = await client!.health();
	expect(health.ready).toBe(true);
	expect(health.answering.stub).toBe(true);
	const answer = await client!.ask('What is the annual occupational dose limit?', false);
	expect(answer.status).toBe('answered');
	expect(answer.citations[0].document_title).toBe('Radiation Protection Handbook');
	expect(answer.citations[0].quote).not.toBe('');
	expect(answer.general_knowledge).toBeNull();
});
it('returns insufficient evidence for a question outside the seeded collection', async () => {
	const answer = await client!.ask('zxqvplmn', false);
	expect(answer.status).toBe('insufficient_evidence');
	expect(answer.documents).toEqual([]);
	expect(answer.citations).toEqual([]);
});
});
