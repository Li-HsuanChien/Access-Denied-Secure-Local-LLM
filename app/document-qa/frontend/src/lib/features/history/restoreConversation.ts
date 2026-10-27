import type { Answer } from '../answering/types';
import { formatAnswerForChat, SECURE_QA_MODEL_ID, toOpenWebUICitations } from '../answering/openWebUIChatAdapter';

/** Translate the workflow's ordered thread into the native chat renderer's tree. */
export function restoreConversation(saved: Record<string, unknown>) {
	const turns = Array.isArray(saved.messages) ? saved.messages : [];
	const messages: Record<string, any> = {};
	let currentId: string | null = null;
	for (const [index, turn] of turns.entries()) {
		const id = `saved-${index}`;
		const answer = turn.answer as Answer | undefined;
		messages[id] = {
			id, parentId: currentId, childrenIds: [], role: turn.role,
			content: answer ? formatAnswerForChat(answer) : String(turn.content ?? ''),
			...(turn.role === 'assistant' ? {
				model: SECURE_QA_MODEL_ID, modelName: 'Document Assistant', done: true,
				citations: answer ? toOpenWebUICitations(answer) : []
			} : { models: [SECURE_QA_MODEL_ID] })
		};
		if (currentId) messages[currentId].childrenIds.push(id);
		currentId = id;
	}
	return { messages, currentId };
}
