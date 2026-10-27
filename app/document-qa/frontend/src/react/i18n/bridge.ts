import { createInstance } from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { assembleSettingsTranslations } from '../../lib/i18n/settings-translations';

export type TranslationOptions = Readonly<Record<string, string | number | boolean | null | undefined>>;
type Dictionary = Record<string, string>;

// Only bundled JSON can be loaded. A detected locale never becomes a network URL.
const catalogs = import.meta.glob<{ default: Dictionary }>('../../lib/i18n/locales/*/translation.json');
async function loadBundledCatalog(language: string): Promise<Dictionary> {
	const load = catalogs[`../../lib/i18n/locales/${language}/translation.json`];
	if (!load) throw new Error(`No bundled catalog for ${language}`);
	return (await load()).default;
}

/** A separate instance keeps the React bridge independent of the original Svelte store. */
export function createI18nBridge(loadCatalog = loadBundledCatalog) {
	const engine = createInstance();
	const listeners = new Set<() => void>();
	let revision = 0;
	let initialization: Promise<void> | undefined;
	function changed() {
		revision++;
		listeners.forEach((listener) => listener());
	}
	engine.on('initialized', changed);
	engine.on('loaded', changed);
	engine.on('languageChanged', (language) => {
		if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', language);
		changed();
	});
	const t = (key: string, options?: TranslationOptions): string => {
		const translated = engine.t(key, options);
		return typeof translated === 'string' ? translated : key;
	};
	return {
		t,
		get language() { return engine.language || 'en-US'; },
		getSnapshot: () => revision,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		initialize(defaultLocale?: string): Promise<void> {
			// Match the active original initI18n defaults; no supportedLngs filtering.
			return initialization ??= engine
				.use(resourcesToBackend(async (language: string) => assembleSettingsTranslations(
					await loadCatalog(language), await loadCatalog('en-US')
				)))
				.use(LanguageDetector)
				.init({
					debug: false,
					detection: {
						order: defaultLocale ? ['querystring', 'localStorage'] : ['querystring', 'localStorage', 'navigator'],
						caches: ['localStorage'], lookupQuerystring: 'lang', lookupLocalStorage: 'locale'
					},
					fallbackLng: { fr: ['fr-FR'], default: defaultLocale ? [defaultLocale] : ['en-US'] },
					ns: 'translation', keySeparator: false, nsSeparator: false,
					returnEmptyString: false, interpolation: { escapeValue: false }
				}).then(() => undefined);
		}
	};
}

export const reactI18n = createI18nBridge();
export const initReactI18n = (): Promise<void> => reactI18n.initialize();
export const translate = reactI18n.t;
