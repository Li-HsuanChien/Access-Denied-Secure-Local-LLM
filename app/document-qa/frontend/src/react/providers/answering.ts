import type { AnswerRequest, AnswerResult, AnsweringState, AppServices, Immutable } from '../../lib/features/react-contracts';
import { ClientError } from '../../lib/features/answering/answeringClient';
import { createStore } from './store';

function freeze<T>(value: T): Immutable<T> {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value as Immutable<T>;
}
export function createAnswering(services: AppServices) {
	const store = createStore<AnsweringState>({ pending: null });
	return {
		...store,
		async ask(request: AnswerRequest): Promise<AnswerResult> {
			if (store.getSnapshot().pending) {
				throw new ClientError('busy', 'Another question is running.', 'Wait for it to finish, then try again.');
			}
			store.update(() => ({ pending: { sessionId: request.sessionId, question: request.question } }));
			try {
				const answer = await services.answering.ask(request.question, request.generalKnowledge);
				// Snapshot before passing the original payload to persistence or presentation.
				const immutableAnswer = freeze(structuredClone(answer));
				let historyWarning: string | null = null;
				try {
					await services.history.save(answer.request_id, request.question, answer as unknown as Record<string, unknown>);
				} catch {
					historyWarning = 'This answer is available here, but could not be saved to local history.';
				}
				return { answer: immutableAnswer, historyWarning };
			} finally {
				store.update(() => ({ pending: null }));
			}
		}
	};
}
