import type { AppServices, PreferenceKey, PreferenceState } from '../../lib/features/react-contracts';
import { createStore, errorMessage } from './store';

export function createPreferences(services: AppServices) {
	const store = createStore<PreferenceState>({
		generalKnowledge: true, historyEnabled: true,
		loaded: { generalKnowledge: false, historyEnabled: false },
		pending: { generalKnowledge: 0, historyEnabled: 0 },
		errors: { generalKnowledge: null, historyEnabled: null }
	});
	const revision = { generalKnowledge: 0, historyEnabled: 0 };
	const reads = { generalKnowledge: 0, historyEnabled: 0 };
	const writes: Record<PreferenceKey, Promise<unknown>> = {
		generalKnowledge: Promise.resolve(), historyEnabled: Promise.resolve()
	};
	async function read(key: PreferenceKey, load: () => Promise<boolean>) {
		if (store.getSnapshot().pending[key]) return;
		const before = revision[key], request = ++reads[key];
		try {
			const value = await load();
			if (revision[key] !== before || reads[key] !== request) return;
			store.update((s) => ({ ...s, [key]: value, loaded: { ...s.loaded, [key]: true },
				errors: { ...s.errors, [key]: null } }));
		} catch (error) {
			if (revision[key] !== before || reads[key] !== request) return;
			store.update((s) => ({ ...s, errors: { ...s.errors, [key]: errorMessage(error, 'The local settings request failed.') } }));
		}
	}
	function write(key: PreferenceKey, save: () => Promise<boolean>): Promise<boolean> {
		// Invalidate initial/refresh reads before the asynchronous write starts.
		revision[key]++;
		store.update((s) => ({ ...s, pending: { ...s.pending, [key]: s.pending[key] + 1 } }));
		const result = writes[key].then(async () => {
			try {
				const value = await save();
				store.update((s) => ({ ...s, [key]: value, loaded: { ...s.loaded, [key]: true },
					errors: { ...s.errors, [key]: null } }));
				return value;
			} catch (error) {
				store.update((s) => ({ ...s, errors: { ...s.errors, [key]: errorMessage(error, 'The local settings request failed.') } }));
				throw error;
			} finally {
				store.update((s) => ({ ...s, pending: { ...s.pending, [key]: s.pending[key] - 1 } }));
			}
		});
		writes[key] = result.catch(() => undefined);
		return result;
	}
	return {
		...store,
		async refresh() {
			await Promise.all([
				read('generalKnowledge', async () => (await services.settings.read()).general_knowledge),
				read('historyEnabled', () => services.history.enabled())
			]);
			return store.getSnapshot();
		},
		setGeneralKnowledge: (value: boolean) =>
			write('generalKnowledge', async () => (await services.settings.update({ general_knowledge: value })).general_knowledge),
		setHistoryEnabled: (value: boolean) => write('historyEnabled', () => services.history.setEnabled(value))
	};
}
