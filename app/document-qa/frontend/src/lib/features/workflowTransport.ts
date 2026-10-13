import { ClientError } from './answering/answeringClient';

const base = 'http://127.0.0.1:8765';

export async function workflowRequest<T>(operation: string, payload: Record<string, unknown> = {}, requestId: string = crypto.randomUUID()): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${base}/v1/requests`, { method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'omit',
			headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: requestId, operation, payload }) });
	} catch {
		throw new ClientError('unreachable', 'The local QA service could not be reached.', 'Start the local service, then try again.');
	}
	const body = await response.json();
	if (!response.ok) throw new ClientError(body.error?.code || 'workflow_failed', body.error?.message || 'The local workflow failed.', body.error?.hint || '');
	if (body.request_id !== requestId || body.operation !== operation || !('result' in body)) throw new ClientError('invalid_response', 'The local service returned an incompatible response.');
	return body.result as T;
}
