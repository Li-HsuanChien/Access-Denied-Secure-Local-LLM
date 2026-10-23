import type { AnsweringClient, ConversationHistoryClient, LibraryClient, SettingsClient } from './wire';

export type AppPath = `/conversation/${string}` | '/' | '/qa' | '/library' | '/history' | '/settings';
export interface RouteState { readonly path: AppPath; readonly chatEpoch: number }
export interface NavigationOptions {
	replace?: boolean;
	newChat?: boolean;
	/** Preserve the existing pinned local-model link on the root chat route. */
	localModel?: boolean;
}
export interface Navigation {
	readonly route: RouteState;
	navigate(path: AppPath, options?: NavigationOptions): void;
}
export interface AppServices {
	readonly answering: AnsweringClient;
	readonly history: ConversationHistoryClient;
	readonly library: LibraryClient;
	readonly settings: SettingsClient;
	readonly createId: () => string;
	readonly now: () => number;
}
export type PreferenceKey = 'generalKnowledge' | 'historyEnabled';
export interface PreferenceState {
	readonly generalKnowledge: boolean;
	readonly historyEnabled: boolean;
	readonly loaded: Readonly<Record<PreferenceKey, boolean>>;
	readonly pending: Readonly<Record<PreferenceKey, number>>;
	readonly errors: Readonly<Record<PreferenceKey, string | null>>;
}
export interface Preferences {
	readonly state: PreferenceState;
	refresh(): Promise<PreferenceState>;
	setGeneralKnowledge(value: boolean): Promise<boolean>;
	setHistoryEnabled(value: boolean): Promise<boolean>;
}
export interface ObservableState<T> {
	getSnapshot(): T;
	subscribe(listener: () => void): () => void;
}
