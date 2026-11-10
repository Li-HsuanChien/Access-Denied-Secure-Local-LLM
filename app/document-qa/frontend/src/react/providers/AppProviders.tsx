import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Answering, AppServices, Library, Navigation, Preferences } from '../../lib/features/react-contracts';
import { createAnsweringClient } from '../../lib/features/answering/answeringClient';
import { createHistoryClient } from '../../lib/features/history/historyClient';
import { createLibraryClient } from '../../lib/features/library/libraryClient';
import { createSettingsClient } from '../../lib/features/settings/settingsClient';
import { createAnswering } from './answering';
import { createLibrary } from './library';
import { createPreferences } from './preferences';
import { createNavigation } from '../routes/navigation';
import { PinnedModelProvider } from '../../lib/features/desktop-shell/react/PinnedModel';
import { ToastProvider } from '../../lib/features/design-system/react';
import { createHealth, type HealthState } from './health';
import { createDocumentViewer, type DocumentViewer } from './documentViewer';

export function createDefaultServices(): AppServices {
	return {
		answering: createAnsweringClient(), history: createHistoryClient(),
		library: createLibraryClient(), settings: createSettingsClient(),
		createId: () => crypto.randomUUID(), now: () => Date.now()
	};
}
/** Construct once per application root. Fixture dependencies are injected here only. */
export function createAppRuntime(services: AppServices = createDefaultServices(), browser: Window = window) {
	return {
		services, preferences: createPreferences(services), answering: createAnswering(services),
		library: createLibrary(services), navigation: createNavigation(browser),
		health: createHealth(services), documentViewer: createDocumentViewer(browser.document)
	};
}
export type AppRuntime = ReturnType<typeof createAppRuntime>;
const RuntimeContext = createContext<AppRuntime | null>(null);
let productionRuntime: AppRuntime | undefined;
function defaultRuntime() {
	// Survives route and provider remounts. No workflow request is started by render.
	return productionRuntime ??= createAppRuntime();
}
export function AppProviders({ children, runtime }: { children: ReactNode; runtime?: AppRuntime }) {
	const value = useRef(runtime ?? defaultRuntime()).current;
	useEffect(() => { void value.preferences.refresh(); }, [value]);
	return <RuntimeContext.Provider value={value}><PinnedModelProvider><ToastProvider>{children}</ToastProvider></PinnedModelProvider></RuntimeContext.Provider>;
}
function useRuntime() {
	const runtime = useContext(RuntimeContext);
	if (!runtime) throw new Error('AppProviders is required.');
	return runtime;
}
export function useServices(): AppServices { return useRuntime().services; }
export function usePreferences(): Preferences {
	const preferences = useRuntime().preferences;
	const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
	return { state, refresh: preferences.refresh, setGeneralKnowledge: preferences.setGeneralKnowledge, setHistoryEnabled: preferences.setHistoryEnabled };
}
export function useAnswering(): Answering {
	const answering = useRuntime().answering;
	const state = useSyncExternalStore(answering.subscribe, answering.getSnapshot);
	return { state, ask: answering.ask };
}
export function useLibrary(): Library {
	const library = useRuntime().library;
	const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
	return { state, select: library.select, confirm: library.confirm, review: library.review,
		publish: library.publish, cancel: library.cancel, refresh: library.refresh, rollback: library.rollback, leave: library.leave, setDocumentEnabled: library.setDocumentEnabled, deleteDocument: library.deleteDocument };
}
export function useNavigation(): Navigation {
	const navigation = useRuntime().navigation;
	const route = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
	return { route, navigate: navigation.navigate };
}
/** Shared readiness from `/health`. The shell refreshes it on mount; anyone may call refresh(). */
export function useHealth(): HealthState & { refresh(): Promise<HealthState> } {
	const health = useRuntime().health;
	const state = useSyncExternalStore(health.subscribe, health.getSnapshot);
	return { ...state, refresh: health.refresh };
}
/** Shared document viewer slot rendered by the shell (side panel >=1180px, full-screen dialog below). */
export function useDocumentViewer(): DocumentViewer {
	const viewer = useRuntime().documentViewer;
	const { current } = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
	return { current, open: viewer.open, close: viewer.close };
}
