import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../../../backend/secure_qa/answering/wire/answer.schema.json';
import type { Answer, AnsweringClient, HealthStatus, HostError } from './types';

const validateAnswer = new Ajv2020({ strict: false }).compile<Answer>(schema);
const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';

export class ClientError extends Error {
	constructor(public code: string, message: string, public hint = '') { super(message); }
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
	return value as Record<string, unknown>;
}
function invalidResponse() { return new ClientError('invalid_response', 'The local service returned an incompatible response.', 'Restart the local QA service and try again.'); }
function isError(value: unknown): value is HostError {
	if (!value || typeof value !== 'object') return false;
	const detail = value as HostError;
	return typeof detail.code === 'string' && typeof detail.message === 'string' && typeof detail.hint === 'string';
}
function endpoint(baseUrl: string) {
	const url = new URL(baseUrl);
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	const octets = host.split('.');
	const loopback = host === 'localhost' || host === '::1' || (octets.length === 4 && octets[0] === '127' && octets.every((part) => /^\d+$/.test(part) && Number(part) <= 255));
	if (!['http:', 'https:'].includes(url.protocol) || !loopback || url.username || url.password) {
		throw new ClientError('invalid_destination', 'The answering service must use a loopback address on this computer.');
	}
	return url.origin;
}
function healthStatus(body: Record<string, unknown>): HealthStatus {
	const library = record(body.library);
	const answering = record(body.answering);
	if (body.api_version !== 'secure-qa-dev/1' || !['ok', 'degraded'].includes(String(body.status)) ||
		typeof body.ready !== 'boolean' || typeof library.ready !== 'boolean' || typeof answering.ready !== 'boolean' ||
		!Number.isInteger(library.document_count) || Number(library.document_count) < 0 ||
		!Number.isInteger(library.chunk_count) || Number(library.chunk_count) < 0 ||
		!(library.active_version === null || typeof library.active_version === 'string') ||
		!(library.embedding_model === null || typeof library.embedding_model === 'string') ||
		!(answering.error == null || isError(answering.error))) throw invalidResponse();
	return body as unknown as HealthStatus;
}
export function createAnsweringClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, createRequestId = () => crypto.randomUUID() }: {
	baseUrl?: string; fetchImpl?: typeof fetch; createRequestId?: () => string;
} = {}): AnsweringClient {
	const base = endpoint(baseUrl);
	async function send(path: string, options: RequestInit) {
		let response: Response;
		try {
			response = await fetchImpl(`${base}${path}`, { ...options, cache: 'no-store', redirect: 'error', credentials: 'omit' });
		} catch {
			throw new ClientError('unreachable', 'The local QA service could not be reached.', 'Start the local service, then try again.');
		}
		let body: Record<string, unknown>;
		try { body = record(await response.json()); } catch { throw invalidResponse(); }
		if (!response.ok) {
			if (!isError(body.error)) throw invalidResponse();
			throw new ClientError(body.error.code, body.error.message, body.error.hint);
		}
		return body;
	}
	return {
		async health() { return healthStatus(await send('/health', { method: 'GET', signal: AbortSignal.timeout(10_000) })); },
		async ask(question, generalKnowledge = true, conversationId?: string) {
			const requestId = createRequestId();
			const payload: Record<string, unknown> = { question, general_knowledge: generalKnowledge };
			if (conversationId) payload.conversation_id = conversationId;
			const envelope = { request_id: requestId, operation: 'answering.ask', payload };
			const response = await send('/v1/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
			if (response.request_id !== requestId || response.operation !== envelope.operation || !validateAnswer(response.result) || response.result.request_id !== requestId) throw invalidResponse();
			return response.result;
		},
		async fetchSource(documentId, version) {
			const query = new URLSearchParams({ document_id: documentId });
			if (version) query.set('version', version);
			let response: Response;
			try {
				response = await fetchImpl(`${base}/v1/source?${query.toString()}`, {
					method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000)
				});
			} catch {
				throw new ClientError('unreachable', 'The local QA service could not be reached.', 'Start the local service, then try again.');
			}
			if (!response.ok) {
				throw new ClientError('source_unavailable', 'The source document could not be opened.',
					'It may not have been cached; republish the collection with its PDFs available.');
			}
			return response.arrayBuffer();
		}
	};
}
