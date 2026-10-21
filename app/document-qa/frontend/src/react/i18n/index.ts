import { useSyncExternalStore } from 'react';
import { reactI18n } from './bridge';

export { initReactI18n, translate } from './bridge';
export type { TranslationOptions } from './bridge';

/** Translate the same keys as the original native UI; product-owned English stays literal. */
export function useI18n() {
	useSyncExternalStore(reactI18n.subscribe, reactI18n.getSnapshot);
	return { t: reactI18n.t, language: reactI18n.language };
}
