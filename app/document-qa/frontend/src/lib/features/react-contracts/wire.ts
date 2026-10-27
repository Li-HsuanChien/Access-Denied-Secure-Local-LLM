/** Existing backend schema is authoritative. These exports do not alter its wire format. */
export type { Answer, Citation, HealthStatus, HostError, AnsweringClient } from '../answering/types';
export type { ConversationHistoryClient, SavedConversation } from '../history/historyClient';
export type { LibraryClient, FileReview, CollectionVersion } from '../library/libraryClient';
export type { SettingsClient, UserSettings } from '../settings/settingsClient';

/** Views receive immutable data; presentation edits never mutate validated answers. */
export type Immutable<T> = T extends readonly (infer V)[]
	? readonly Immutable<V>[]
	: T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

export interface SavedAnswerRecord {
	readonly conversation_id: string;
	readonly title: string;
	readonly updated_at: string;
	readonly model_id: string | null;
	readonly collection_version: string | null;
	readonly answer: Immutable<import('../answering/types').Answer>;
}
