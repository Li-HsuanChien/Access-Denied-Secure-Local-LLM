import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../../backend/secure_qa/answering/wire/answer.schema.json';
import type { Answer, SavedAnswerRecord } from '../../lib/features/react-contracts';
import { ClientError } from '../../lib/features/answering/answeringClient';

const validate = new Ajv2020({ strict: false }).compile<Answer>(schema);
export function readAnswer(value: unknown): Answer {
 if (!validate(value)) throw new ClientError('invalid_response', 'The local service returned an incompatible response.');
 return structuredClone(value);
}
/** history.open still uses the existing client. Validate before exposing its stored answer. */
export function readSavedAnswer(record: Record<string, unknown> | null): SavedAnswerRecord | null {
	if (record === null) return null;
	if (typeof record.conversation_id !== 'string' || typeof record.title !== 'string' ||
		typeof record.updated_at !== 'string' ||
		!(record.model_id === null || typeof record.model_id === 'string') ||
		!(record.collection_version === null || typeof record.collection_version === 'string') ||
		!validate(record.answer)) {
		throw new ClientError('invalid_response', 'The local service returned an incompatible response.');
	}
	return {
		conversation_id: record.conversation_id, title: record.title, updated_at: record.updated_at,
		model_id: record.model_id, collection_version: record.collection_version,
		answer: structuredClone(record.answer)
	};
}
