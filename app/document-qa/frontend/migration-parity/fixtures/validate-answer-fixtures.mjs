import fs from 'node:fs';
import { createRequire } from 'node:module';
import { answerFor, createFixtureState, respond } from './responses.mjs';

const require = createRequire(import.meta.url);
const Ajv2020 = require('../../node_modules/ajv/dist/2020.js').default;
const schemaPath = new URL('../../../backend/secure_qa/answering/wire/answer.schema.json', import.meta.url);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);
const request = { request_id: '00000000-0000-4000-8000-000000000001', payload: { question: 'Fixture question', general_knowledge: true } };

for (const mode of ['answer', 'rich', 'long', 'insufficient']) {
	const answer = answerFor(request, mode);
	if (!validate(answer)) throw new Error(`${mode} answer fixture failed the backend schema: ${JSON.stringify(validate.errors)}`);
	console.log(`${mode}: valid`);
}

const state = createFixtureState();
await respond(state, { request_id: 'fixture-publish', operation: 'library.publish', payload: {} });
if (state.versions.find(version => version.status === 'active')?.version_id !== 'fixture-v2') throw new Error('Publish fixture did not activate the new version.');
await respond(state, { request_id: 'fixture-rollback', operation: 'library.rollback', payload: {} });
const versions = await respond(state, { request_id: 'fixture-versions', operation: 'library.versions', payload: {} });
if (versions.body.result.active !== 'fixture-v1') throw new Error(`Rollback fixture reports the wrong active version: ${versions.body.result.active}`);
console.log('library publish/rollback state: valid');
