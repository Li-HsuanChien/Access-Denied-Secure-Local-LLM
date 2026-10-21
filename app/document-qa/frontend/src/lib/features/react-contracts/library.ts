import type { CollectionVersion, FileReview, Immutable } from './wire';
export interface SelectedPdf { readonly name: string; readonly size: number; readonly data: string }
export interface Publication {
	readonly requestId: string;
	readonly startedAt: number;
	readonly progress: string;
	readonly elapsedSeconds: number;
	readonly cancellation: 'available' | 'requested' | 'unavailable';
	readonly statusError: string | null;
}
export interface LibraryState {
	readonly selected: readonly SelectedPdf[];
	readonly review: Immutable<FileReview> | null;
	readonly confirmed: boolean;
	readonly attempted: boolean;
	readonly busy: boolean;
	readonly publication: Publication | null;
	readonly versions: readonly Immutable<CollectionVersion>[];
	readonly notice: string;
	readonly error: string;
}
export interface Library {
	readonly state: LibraryState;
	select(files: readonly SelectedPdf[]): void;
	confirm(value: boolean): void;
	review(): Promise<void>;
	publish(): Promise<void>;
	cancel(): Promise<void>;
	refresh(): Promise<void>;
	rollback(): Promise<void>;
	/** Reset non-job route state on exit; never removes an active publication. */
	leave(): void;
}
