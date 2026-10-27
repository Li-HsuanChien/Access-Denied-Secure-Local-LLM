import { expect, it } from 'vitest';
import { createAnsweringClient } from './answeringClient';

// Start backend/dev_host.py before running npm run test:host.
const client = createAnsweringClient();
it('reads the seeded host and returns a citation-bearing answer through the public client', async () => {
	const health = await client.health();
	expect(health.ready).toBe(true);
	expect(health.answering.stub).toBe(true);
	const answer = await client.ask('What is the annual occupational dose limit?', false);
	expect(answer.status).toBe('answered');
	expect(answer.citations[0].document_title).toBe('Radiation Protection Handbook');
	expect(answer.citations[0].quote).not.toBe('');
	expect(answer.general_knowledge).toBeNull();
});
it('returns insufficient evidence for a question outside the seeded collection', async () => {
	const answer = await client.ask('zxqvplmn', false);
	expect(answer.status).toBe('insufficient_evidence');
	expect(answer.documents).toEqual([]);
	expect(answer.citations).toEqual([]);
});
