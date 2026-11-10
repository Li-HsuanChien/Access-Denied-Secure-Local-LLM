import { useEffect, useSyncExternalStore } from 'react';

/**
 * Theme preference. Uses the app's existing frontend preference, `localStorage.theme`
 * ('system' | 'light' | 'dark'; anything else means system). No host setting is involved.
 * The resolved theme is written to <html data-theme> (read by personality.css tokens) and to the
 * legacy `.dark` class that unmigrated upstream CSS still keys on.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const listeners = new Set<() => void>();
let memory: ThemePreference = 'system';

function readPreference(): ThemePreference {
	try {
		const value = localStorage.getItem('theme');
		return value === 'light' || value === 'dark' || value === 'system' ? value : value === null ? memory : 'system';
	} catch { return memory; }
}

function systemDark(): boolean {
	try { return typeof window.matchMedia === 'function' && !!window.matchMedia('(prefers-color-scheme: dark)')?.matches; } catch { return false; }
}

export function resolveTheme(preference: ThemePreference = readPreference()): ResolvedTheme {
	return preference === 'dark' || (preference === 'system' && systemDark()) ? 'dark' : 'light';
}

/** Applies the current preference to the document element. */
export function applyTheme(root: HTMLElement = document.documentElement): ResolvedTheme {
	const resolved = resolveTheme();
	root.setAttribute('data-theme', resolved);
	root.classList.toggle('dark', resolved === 'dark');
	return resolved;
}

/** Saves the preference (in memory if storage is unavailable) and applies it immediately. */
export function setThemePreference(preference: ThemePreference) {
	memory = preference;
	try { localStorage.setItem('theme', preference); } catch { /* in-memory fallback */ }
	applyTheme();
	listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** For Settings: `{theme, setTheme}`; the shell keeps the document in sync. */
export function useTheme(): { theme: ThemePreference; setTheme(preference: ThemePreference): void } {
	const theme = useSyncExternalStore(subscribe, readPreference, () => 'system' as const);
	return { theme, setTheme: setThemePreference };
}

/** Shell-only: apply on mount and follow system changes while the preference is 'system'. */
export function useThemeSync() {
	useEffect(() => {
		applyTheme();
		if (typeof window.matchMedia !== 'function') return;
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => { applyTheme(); listeners.forEach(listener => listener()); };
		media?.addEventListener?.('change', onChange);
		return () => media?.removeEventListener?.('change', onChange);
	}, []);
}
