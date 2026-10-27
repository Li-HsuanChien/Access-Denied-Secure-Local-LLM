import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createI18nBridge } from './bridge';
import { mountWithLocale } from './bootstrap';
import { initReactI18n, translate, useI18n } from './index';

beforeEach(() => {
	window.history.replaceState(null, '', '/qa');
	localStorage.clear();
	document.documentElement.lang = 'en';
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
	vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Localization must not fetch resources'); }));
});
afterEach(() => {
	expect(fetch).not.toHaveBeenCalled();
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it('query lang wins over stored locale and navigator, caches it and sets html.lang', async () => {
	window.history.replaceState(null, '', '/qa?lang=fr-FR');
	localStorage.setItem('locale', 'de-DE');
	const bridge = createI18nBridge();
	await bridge.initialize();
	expect(bridge.language).toBe('fr-FR');
	expect(document.documentElement.lang).toBe('fr-FR');
	expect(localStorage.getItem('locale')).toBe('fr-FR');
	expect(bridge.t('New Chat')).toBe('Nouvelle conversation');
	expect(bridge.t('Temporary Chat')).toBe('conversation temporaire');
	expect(bridge.t('Suggested')).toBe('Suggéré');
});

it('stored locale wins over navigator and retains catalog interpolation and singular labels', async () => {
	localStorage.setItem('locale', 'de-DE');
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
	const bridge = createI18nBridge();
	await bridge.initialize();
	expect(bridge.language).toBe('de-DE');
	expect(document.documentElement.lang).toBe('de-DE');
	expect(bridge.t('New Chat')).toBe('Neuer Chat');
	expect(bridge.t('1 Source')).toBe('1 Quelle');
	expect(bridge.t('{{COUNT}} Sources', { COUNT: 3 })).toBe('3 Quellen');
	expect(bridge.t('Version {{selectedVersion}} of {{totalVersions}}', { selectedVersion: 2, totalVersions: 4 })).toBe('Version 2 von 4');
});

it('detects and caches navigator locale when query and storage are absent', async () => {
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US']);
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
	const bridge = createI18nBridge();
	await bridge.initialize();
	expect(bridge.t('Suggested')).toBe('Suggéré');
	expect(bridge.language).toBe('fr-FR');
	expect(localStorage.getItem('locale')).toBe('fr-FR');
	expect(document.documentElement.lang).toBe('fr-FR');
});

it('uses the original French base-language fallback without normalizing its language attribute', async () => {
	window.history.replaceState(null, '', '/qa?lang=fr');
	const bridge = createI18nBridge();
	await bridge.initialize();
	expect(bridge.t('New Chat')).toBe('Nouvelle conversation');
	expect(bridge.language).toBe('fr');
	expect(document.documentElement.lang).toBe('fr');
	expect(localStorage.getItem('locale')).toBe('fr');
});

it('falls back to English values or literal keys for unknown languages and empty translations', async () => {
	window.history.replaceState(null, '', '/qa?lang=xx-ZZ');
	const bridge = createI18nBridge();
	await bridge.initialize();
	expect(bridge.t('settings.personal.general.language.label')).toBe('Language');
	expect(bridge.t('New Chat')).toBe('New Chat');
	expect(bridge.t('Unknown.key: {{value}}', { value: '<b>text</b>' })).toBe('Unknown.key: <b>text</b>');
	expect(bridge.language).toBe('xx-ZZ');
	expect(document.documentElement.lang).toBe('xx-ZZ');
});

it('keeps the optional original default-locale behavior that excludes navigator detection', async () => {
	const bridge = createI18nBridge();
	await bridge.initialize('de-DE');
	expect(bridge.t('New Chat')).toBe('Neuer Chat');
	expect(document.documentElement.lang).toBe('de-DE');
});

it('keeps literal keys usable when bundled resource loading fails', async () => {
	const bridge = createI18nBridge(async () => { throw new Error('catalog unavailable'); });
	await bridge.initialize();
	expect(bridge.t('New Chat')).toBe('New Chat');
	expect(bridge.t('{{COUNT}} Sources', { COUNT: 2 })).toBe('2 Sources');
});

it('mounts with key fallback even if locale initialization rejects', async () => {
	const bridge = createI18nBridge();
	const mount = vi.fn(() => render(<span>{bridge.t('New Chat')}</span>));
	await expect(mountWithLocale(mount, async () => { throw new Error('initialization failed'); })).resolves.toBeUndefined();
	expect(mount).toHaveBeenCalledTimes(1);
	expect(screen.getByText('New Chat')).toBeTruthy();
});

it('subscribes React consumers to initialization and shares translation with callbacks', async () => {
	localStorage.setItem('locale', 'de-DE');
	function Label() {
		const { t, language } = useI18n();
		return <span lang={language}>{t('New Chat')}</span>;
	}
	render(<Label />);
	expect(screen.getByText('New Chat')).toBeTruthy();
	await act(async () => { await initReactI18n(); });
	expect(screen.getByText('Neuer Chat').getAttribute('lang')).toBe('de-DE');
	expect(translate('1 Source')).toBe('1 Quelle');
});
