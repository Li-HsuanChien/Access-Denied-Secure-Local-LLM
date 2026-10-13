import { workflowRequest } from '../workflowTransport';

export interface SavedConversation { conversation_id: string; title: string; updated_at: string; model_id: string | null; collection_version: string | null }
export interface ConversationHistoryClient {
	list(): Promise<SavedConversation[]>;
	open(id: string): Promise<Record<string, unknown> | null>;
	save(id: string, title: string, answer: Record<string, unknown>): Promise<boolean>;
	remove(id: string): Promise<boolean>;
	clear(): Promise<void>;
	enabled(): Promise<boolean>;
	setEnabled(value: boolean): Promise<boolean>;
}
export function createHistoryClient(): ConversationHistoryClient {
	return {
		list: async () => (await workflowRequest<{ conversations: SavedConversation[] }>('history.list')).conversations,
		open: async (id) => (await workflowRequest<{ conversation: Record<string, unknown> | null }>('history.open', { conversation_id: id })).conversation,
		save: async (id, title, answer) => (await workflowRequest<{ saved: boolean }>('history.save', { conversation_id: id, title, answer })).saved,
		remove: async (id) => (await workflowRequest<{ deleted: boolean }>('history.delete', { conversation_id: id })).deleted,
		clear: async () => { await workflowRequest('history.clear'); },
		enabled: async () => (await workflowRequest<{ enabled: boolean }>('history.enabled')).enabled,
		setEnabled: async (value) => (await workflowRequest<{ enabled: boolean }>('history.set_enabled', { enabled: value })).enabled
	};
}
