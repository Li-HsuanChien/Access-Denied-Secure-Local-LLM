import type { Answer, Immutable } from './wire';

export type MessageId = string;
export type SessionId = string;
export interface MessageBase {
	readonly id: MessageId;
	readonly parentId: MessageId | null;
	readonly childIds: readonly MessageId[];
	readonly createdAt: number;
	/** Local, editable presentation. Never written back into Answer. */
	readonly content: string;
}
export interface UserMessage extends MessageBase { readonly role: 'user' }
export interface AssistantMessage extends MessageBase {
	readonly role: 'assistant';
	readonly status: 'pending' | 'complete' | 'error';
	readonly answer: Immutable<Answer> | null;
	readonly historyWarning: string | null;
	readonly error: string | null;
}
export type ChatMessage = UserMessage | AssistantMessage;
export interface QueuedQuestion { readonly id: string; readonly question: string }
export interface ChatSession {
	readonly id: SessionId;
	readonly messages: Readonly<Record<MessageId, ChatMessage>>;
	readonly currentId: MessageId | null;
	readonly draft: string;
	readonly queue: readonly QueuedQuestion[];
}
export interface AnswerRequest {
	readonly sessionId: SessionId;
	readonly question: string;
	readonly generalKnowledge: boolean;
}
export interface AnswerResult {
	readonly answer: Immutable<Answer>;
	readonly historyWarning: string | null;
}
export interface AnsweringState {
	readonly pending: { readonly sessionId: SessionId; readonly question: string } | null;
}
/** App-wide single-flight seam. Queue and branch graph belong to Chat, not transport. */
export interface Answering {
	readonly state: AnsweringState;
	ask(request: AnswerRequest): Promise<AnswerResult>;
}
/** Stage 3B implements this controller inside answering/react, against Answering. */
export interface ChatController {
	readonly session: ChatSession;
	setDraft(text: string): void;
	submit(text?: string): void;
	editQueued(id: string): void;
	deleteQueued(id: string): void;
	saveUserEdit(id: MessageId, text: string): void;
	sendUserEdit(id: MessageId, text: string): void;
	saveAssistantEdit(id: MessageId, text: string, asCopy: boolean): void;
	regenerate(id: MessageId, suggestion?: string): void;
	selectBranch(parentId: MessageId | null, childId: MessageId): void;
	deleteAssistant(id: MessageId): void;
}
