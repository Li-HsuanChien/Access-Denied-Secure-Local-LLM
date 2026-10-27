export function createStore<T>(initial: T) {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		update(update: (current: T) => T) {
			state = update(state);
			listeners.forEach((listener) => listener());
		}
	};
}
export const errorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;
