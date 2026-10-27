import { initReactI18n } from './bridge';

/** A locale initialization failure must not prevent the existing application from mounting. */
export async function mountWithLocale(mount: () => void, initialize = initReactI18n): Promise<void> {
	try { await initialize(); } catch { /* Translation keys remain the English fallback. */ }
	mount();
}
