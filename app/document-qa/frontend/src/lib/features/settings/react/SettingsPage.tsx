import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PreferenceKey } from '../../react-contracts';
import { useAnswering, useHealth, usePreferences, useServices } from '../../../../react/providers';
import {
	Button, IconAlert, IconCheck, IconLock, IconMonitor, IconMoon, IconSun, Segmented, Spinner, useToast
} from '../../design-system/react';
import { OpenWebUiCredit } from '../../desktop-shell/react/OpenWebUiCredit';
import { useTheme, type ThemePreference } from '../../desktop-shell/react/theme';
import { notifyHistoryChanged, useSavedThreads } from '../../desktop-shell/react/useSavedThreads';
import './settings.css';

function message(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const SAVED_VISIBLE_MS = 4000;

function SaveStatus({ state, error }: { state: SaveState; error: string }) {
	return <>
		<span className="settings-save-status" data-state={state} role="status" aria-live="polite">
			{state === 'saving' && <><Spinner size={12} /> Saving…</>}
			{state === 'saved' && <><IconCheck size={14} /> Saved</>}
		</span>
		{state === 'error' && <p className="ui-form-error settings-row-error" role="alert"><IconAlert size={14} /> <span>{error}</span> Your previous setting is kept. Try again.</p>}
	</>;
}

/**
 * Accessible switch backed by a native checkbox (role="switch"), drawn with the kit's `ui-switch`
 * track so it matches every other switch. The native control keeps label association and `checked`.
 */
function SettingSwitch({ checked, pending, labelledBy, describedBy, onChange }: {
	checked: boolean; pending: boolean; labelledBy: string; describedBy: string; onChange: (next: boolean) => void;
}) {
	return (
		<span className="ui-switch settings-switch" data-state={checked ? 'on' : 'off'} data-pending={pending || undefined}>
			<input type="checkbox" role="switch" checked={checked} aria-labelledby={labelledBy} aria-describedby={describedBy}
				aria-busy={pending || undefined} onChange={(event) => onChange(event.currentTarget.checked)} />
			<span className="ui-switch-thumb" aria-hidden="true" />
		</span>
	);
}

function SettingRow({ title, description, children, status }: {
	title: string; description: ReactNode; status?: ReactNode;
	children: (ids: { label: string; desc: string }) => ReactNode;
}) {
	const label = useId();
	const desc = useId();
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<p id={label} className="settings-row-title">{title}</p>
				<p id={desc} className="settings-row-desc">{description}</p>
				{status}
			</div>
			<div className="settings-row-control">{children({ label, desc })}</div>
		</div>
	);
}

/** Per-preference Saving…/Saved/error state for host-confirmed writes; failures keep the confirmed value. */
function usePreferenceWrite(key: PreferenceKey, write: (value: boolean) => Promise<boolean>) {
	const preferences = usePreferences();
	const [state, setState] = useState<Exclude<SaveState, 'saving'>>('idle');
	const [error, setError] = useState('');
	const timer = useRef<number | undefined>(undefined);
	const writing = useRef(0);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	async function change(value: boolean) {
		window.clearTimeout(timer.current);
		setState('idle'); setError('');
		writing.current += 1;
		try {
			await write(value);
			setState('saved');
			timer.current = window.setTimeout(() => setState('idle'), SAVED_VISIBLE_MS);
		} catch (cause) {
			setError(message(cause, 'Could not save this preference.'));
			setState('error');
		} finally {
			writing.current -= 1;
		}
	}
	const saving = preferences.state.pending[key] > 0;
	// A write failure is reported on its own row; while a write is settling its error is not a read failure.
	const ownsError = (value: string | null) => !!value && (writing.current > 0 || (state === 'error' && value === error));
	return { state: (saving ? 'saving' : state) as SaveState, error, change, ownsError };
}

const readinessLabel = { checking: 'Checking…', ready: 'Ready', 'needs-documents': 'Add documents to start', unavailable: 'Not available' } as const;

/**
 * Settings is a routed page (/settings) rather than the prototype's dialog: the sidebar already links to
 * the route, a dialog over the shell would make Settings unreachable by URL and stack with shell overlays.
 */
export function SettingsPage() {
	const services = useServices();
	const preferences = usePreferences();
	const health = useHealth();
	const { state: answeringState } = useAnswering();
	const { theme, setTheme } = useTheme();
	const threads = useSavedThreads();
	const toast = useToast();
	const general = usePreferenceWrite('generalKnowledge', preferences.setGeneralKnowledge);
	const history = usePreferenceWrite('historyEnabled', preferences.setHistoryEnabled);
	const [clearing, setClearing] = useState<'idle' | 'confirm' | 'pending' | 'error'>('idle');
	const [clearError, setClearError] = useState('');
	const clearTrigger = useRef<HTMLButtonElement>(null);
	const historyHeading = useRef<HTMLHeadingElement>(null);
	const wasConfirming = useRef(false);
	const justCleared = useRef(false);

	useEffect(() => {
		document.title = 'Settings · Access Denied';
		void preferences.refresh();
		void health.refresh();
	}, [preferences.refresh, health.refresh]);

	// Leaving the inline confirmation returns focus to "Delete all…", or the section heading if history is now empty.
	useEffect(() => {
		if (clearing === 'confirm' || clearing === 'pending') { wasConfirming.current = true; return; }
		if (!wasConfirming.current) return;
		wasConfirming.current = false;
		const trigger = clearTrigger.current;
		const cleared = justCleared.current;
		justCleared.current = false;
		(!cleared && trigger && !trigger.disabled ? trigger : historyHeading.current)?.focus();
	}, [clearing]);

	async function checkAgain() {
		await Promise.allSettled([health.refresh(), preferences.refresh()]);
	}

	async function clearAll() {
		setClearing('pending');
		try {
			await services.history.clear();
			notifyHistoryChanged();
			justCleared.current = true;
			setClearError('');
			setClearing('idle');
			toast({ tone: 'success', text: 'All saved conversations were deleted.' });
		} catch (cause) {
			setClearError(message(cause, 'Could not clear saved history.'));
			setClearing('error');
		}
	}

	const errors = preferences.state.errors;
	const readError = [
		general.ownsError(errors.generalKnowledge) ? null : errors.generalKnowledge,
		history.ownsError(errors.historyEnabled) ? null : errors.historyEnabled
	].find(Boolean) || '';
	const savedCount = threads.rows.length;
	const library = health.health?.library;
	const count = (n: number | undefined, noun: string) => typeof n === 'number' ? `${n} ${noun}${n === 1 ? '' : 's'}` : null;
	const confirming = clearing === 'confirm' || clearing === 'pending';
	const onConfirmKey = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && clearing === 'confirm') { event.stopPropagation(); setClearing('idle'); }
	};

	return (
		<div className="settings-view">
			<div className="settings-inner">
				<header className="settings-head">
					<h1 className="settings-title">Settings</h1>
					<p className="settings-sub">Stored on this computer. Nothing here connects to a network.</p>
				</header>
				{readError && <p role="alert" className="ui-callout ui-callout-error settings-read-error">{readError}</p>}

				<section className="settings-section" aria-labelledby="settings-answers">
					<h2 id="settings-answers" className="settings-heading">Answers</h2>
					<SettingRow
						title="Include general model knowledge by default"
						description="When your documents can’t answer, the assistant may answer from what it already knows. These answers are always labeled and never cite your documents."
						status={<SaveStatus state={general.state} error={general.error} />}
					>
						{(ids) => <SettingSwitch checked={preferences.state.generalKnowledge} pending={general.state === 'saving'} labelledBy={ids.label} describedBy={ids.desc} onChange={(value) => void general.change(value)} />}
					</SettingRow>
				</section>

				<section className="settings-section" aria-labelledby="settings-history">
					<h2 id="settings-history" ref={historyHeading} tabIndex={-1} className="settings-heading">History</h2>
					<SettingRow
						title="Save conversations on this computer"
						description="Saved chats appear in the sidebar so you can continue them later. Turning this off stops saving new chats; existing ones stay until you delete them. Saved data relies on your computer’s disk encryption."
						status={<SaveStatus state={history.state} error={history.error} />}
					>
						{(ids) => <SettingSwitch checked={preferences.state.historyEnabled} pending={history.state === 'saving'} labelledBy={ids.label} describedBy={ids.desc} onChange={(value) => void history.change(value)} />}
					</SettingRow>
					<div className="settings-row settings-row-danger">
						{!confirming ? <>
							<div className="settings-row-text">
								<p className="settings-row-title">Delete all saved conversations</p>
								<p className="settings-row-desc">{!threads.loaded ? 'Checking saved conversations…' : savedCount ? `${savedCount} ${savedCount === 1 ? 'conversation' : 'conversations'} saved on this computer.` : 'There are no saved conversations.'}</p>
								{answeringState.pending && <p className="settings-row-desc">Available after the current answer finishes.</p>}
								{clearing === 'error' && <p className="ui-form-error" role="alert">{clearError} Nothing was deleted. Try again.</p>}
							</div>
							<Button ref={clearTrigger} variant="danger-ghost" size="sm" disabled={!savedCount || !!answeringState.pending} onClick={() => setClearing('confirm')}>Delete all…</Button>
						</> : <div className="settings-inline-confirm" role="group" aria-labelledby="settings-clear-question" onKeyDown={onConfirmKey}>
							<p id="settings-clear-question"><strong>Delete all {savedCount} {savedCount === 1 ? 'conversation' : 'conversations'}?</strong> This can’t be undone.</p>
							<div className="settings-inline-confirm-buttons">
								<Button variant="ghost" size="sm" onClick={() => setClearing('idle')} disabled={clearing === 'pending'} autoFocus>Cancel</Button>
								<Button variant="danger" size="sm" onClick={() => void clearAll()} pending={clearing === 'pending'}>Delete all</Button>
							</div>
						</div>}
					</div>
				</section>

				<section className="settings-section" aria-labelledby="settings-appearance">
					<h2 id="settings-appearance" className="settings-heading">Appearance</h2>
					<div className="settings-row settings-row-wrap">
						<div className="settings-row-text">
							<p className="settings-row-title">Theme</p>
							<p className="settings-row-desc">System follows your computer’s light or dark setting.</p>
						</div>
						<div className="settings-row-control">
							<Segmented<ThemePreference>
								label="Theme"
								value={theme}
								onChange={setTheme}
								options={[
									{ value: 'system', label: 'System', icon: <IconMonitor size={15} /> },
									{ value: 'light', label: 'Light', icon: <IconSun size={15} /> },
									{ value: 'dark', label: 'Dark', icon: <IconMoon size={15} /> }
								]}
							/>
						</div>
					</div>
				</section>

				<section className="settings-section" aria-labelledby="settings-computer">
					<div className="settings-heading-row">
						<h2 id="settings-computer" className="settings-heading">This computer</h2>
						<Button size="sm" variant="secondary" pending={health.refreshing} onClick={() => void checkAgain()}>Check again</Button>
					</div>
					<dl className="ui-status-list settings-status">
						<div><dt>Status</dt><dd role="status">{readinessLabel[health.readiness]}</dd></div>
						{health.message && <div><dt>Details</dt><dd>{health.message}</dd></div>}
						<div><dt>Local model</dt><dd>{health.readiness === 'checking' ? 'Checking…' : health.health?.answering.ready ? 'Ready' : 'Not ready'}</dd></div>
						<div><dt>Library</dt><dd>{library ? [count(library.document_count, 'document'), count(library.chunk_count, 'passage')].filter(Boolean).join(' · ') + ' in use' : '—'}</dd></div>
						<div><dt>Network</dt><dd><IconLock size={13} /> Offline. Nothing leaves this computer.</dd></div>
					</dl>
				</section>

				<section className="settings-section" aria-labelledby="settings-about">
					<h2 id="settings-about" className="settings-heading">About</h2>
					<p className="settings-about">Access Denied answers questions from your own documents, privately, on this computer.</p>
					<OpenWebUiCredit className="settings-credit" />
				</section>
			</div>
		</div>
	);
}
