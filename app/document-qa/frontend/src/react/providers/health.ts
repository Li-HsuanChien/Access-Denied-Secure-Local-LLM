import type { AppServices } from '../../lib/features/react-contracts';
import type { HealthStatus } from '../../lib/features/answering/types';
import { createStore, errorMessage } from './store';

/**
 * Readiness derived from the existing `/health` read (no new host operation).
 * - checking: first read in flight
 * - ready: model and library ready
 * - needs-documents: model ready, nothing published yet
 * - unavailable: model not ready, or the local service could not be reached
 */
export type Readiness = 'checking' | 'ready' | 'needs-documents' | 'unavailable';
export interface HealthState {
	readonly readiness: Readiness;
	readonly health: HealthStatus | null;
	/** Plain-language reason when not ready (host error message or transport failure). */
	readonly message: string;
	readonly refreshing: boolean;
}

export function readinessOf(health: HealthStatus): Readiness {
	if (health.ready) return 'ready';
	return health.answering?.ready ? 'needs-documents' : 'unavailable';
}

export function createHealth(services: AppServices) {
	const store = createStore<HealthState>({ readiness: 'checking', health: null, message: '', refreshing: false });
	let read = 0;
	async function refresh(): Promise<HealthState> {
		const request = ++read;
		store.update((s) => ({ ...s, refreshing: true }));
		try {
			const health = await services.answering.health();
			if (request === read) store.update(() => ({
				readiness: readinessOf(health), health, refreshing: false,
				message: health.ready ? '' : health.answering?.ready
					? 'Local model ready. Publish documents to your Library to start asking questions.'
					: health.answering?.error?.message ?? 'The local model or library is not ready.'
			}));
		} catch (error) {
			if (request === read) store.update((s) => ({ ...s, readiness: 'unavailable', refreshing: false,
				message: errorMessage(error, 'The local service is unavailable.') }));
		}
		return store.getSnapshot();
	}
	return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, refresh };
}
