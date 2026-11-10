import { useEffect, useId, useRef, useState } from 'react';
import { MODEL } from '../../data/samples';
import { useStore, type SaveState } from '../../store';
import { IconAlert, IconCheck, IconLock, IconMonitor, IconMoon, IconSun } from '../../ui/icons';
import { Dialog } from '../../ui/overlay';
import { Button, Segmented, Spinner, Switch } from '../../ui/primitives';

function SaveStatus({ state }: { state: SaveState }) {
	return (
		<span className="save-status" data-state={state} role="status" aria-live="polite">
			{state === 'saving' && <><Spinner size={12} /> Saving…</>}
			{state === 'saved' && <><IconCheck size={14} /> Saved</>}
			{state === 'error' && <><IconAlert size={14} /> Couldn’t save. Try again.</>}
		</span>
	);
}

function SettingRow({ title, description, children, status }: { title: string; description: string; children: (ids: { label: string; desc: string }) => React.ReactNode; status?: SaveState }) {
	const label = useId();
	const desc = useId();
	return (
		<div className="setting-row">
			<div className="setting-text">
				<p id={label} className="setting-title">{title}</p>
				<p id={desc} className="setting-desc">{description}</p>
				{status && <SaveStatus state={status} />}
			</div>
			<div className="setting-control">{children({ label, desc })}</div>
		</div>
	);
}

export function SettingsDialog() {
	const store = useStore();
	const { settings, saveState } = store;
	const [clearing, setClearing] = useState<'idle' | 'confirm' | 'pending' | 'error'>('idle');
	const savedCount = store.conversations.filter(c => c.saved).length;
	const enabled = store.docs.filter(d => d.enabled).length;
	const clearTrigger = useRef<HTMLButtonElement>(null);
	const wasConfirming = useRef(false);
	useEffect(() => { if (!store.settingsOpen) setClearing('idle'); }, [store.settingsOpen]);
	// Leaving the inline confirmation returns focus to the button that opened it (or the dialog if history is now empty).
	useEffect(() => {
		if (clearing === 'confirm' || clearing === 'pending') { wasConfirming.current = true; return; }
		if (!wasConfirming.current) return;
		wasConfirming.current = false;
		const target = clearTrigger.current && !clearTrigger.current.disabled ? clearTrigger.current : document.querySelector<HTMLElement>('.settings .dialog-footer .btn');
		target?.focus();
	}, [clearing]);

	const clear = async () => {
		setClearing('pending');
		try { await store.clearHistory(); setClearing('idle'); }
		catch { setClearing('error'); }
	};

	return (
		<Dialog
			open={store.settingsOpen}
			onClose={() => store.setSettingsOpen(false)}
			title="Settings"
			className="settings"
			footer={<Button variant="primary" onClick={() => store.setSettingsOpen(false)}>Done</Button>}
		>
			<section className="settings-section" aria-labelledby="set-answers">
				<h3 id="set-answers" className="settings-heading">Answers</h3>
				<SettingRow
					title="Use general knowledge as a fallback"
					description="When your documents can’t answer, the assistant may answer from what it already knows. These answers are always labeled and never cite your documents."
					status={saveState.generalKnowledge}
				>
					{ids => <Switch checked={settings.generalKnowledge} pending={saveState.generalKnowledge === 'saving'} labelledBy={ids.label} describedBy={ids.desc} onChange={v => void store.updateSetting('generalKnowledge', v)} />}
				</SettingRow>
			</section>

			<section className="settings-section" aria-labelledby="set-history">
				<h3 id="set-history" className="settings-heading">History</h3>
				<SettingRow
					title="Save conversations on this computer"
					description="Saved chats appear in the sidebar so you can continue them later. Turning this off stops saving new chats; existing ones stay until you delete them."
					status={saveState.historyEnabled}
				>
					{ids => <Switch checked={settings.historyEnabled} pending={saveState.historyEnabled === 'saving'} labelledBy={ids.label} describedBy={ids.desc} onChange={v => void store.updateSetting('historyEnabled', v)} />}
				</SettingRow>
				<div className="setting-row setting-row-danger">
					{clearing === 'idle' || clearing === 'error' ? (
						<>
							<div className="setting-text">
								<p className="setting-title">Delete all saved conversations</p>
								<p className="setting-desc">{savedCount ? `${savedCount} ${savedCount === 1 ? 'conversation' : 'conversations'} saved on this computer.` : 'There are no saved conversations.'}</p>
								{clearing === 'error' && <p className="form-error" role="alert">History couldn’t be cleared. Nothing was deleted. Try again.</p>}
							</div>
							<Button ref={clearTrigger} variant="danger-ghost" size="sm" disabled={!savedCount} onClick={() => setClearing('confirm')}>Delete all…</Button>
						</>
					) : (
						<div className="inline-confirm" role="group" aria-labelledby="clear-q">
							<p id="clear-q"><strong>Delete all {savedCount} conversations?</strong> This can’t be undone.</p>
							<div className="inline-confirm-buttons">
								<Button variant="ghost" size="sm" onClick={() => setClearing('idle')} disabled={clearing === 'pending'} autoFocus>Cancel</Button>
								<Button variant="danger" size="sm" onClick={clear} pending={clearing === 'pending'}>Delete all</Button>
							</div>
						</div>
					)}
				</div>
			</section>

			<section className="settings-section" aria-labelledby="set-look">
				<h3 id="set-look" className="settings-heading">Appearance</h3>
				<Segmented
					label="Theme"
					value={settings.theme}
					onChange={store.setTheme}
					options={[
						{ value: 'system', label: 'System', icon: <IconMonitor size={15} /> },
						{ value: 'light', label: 'Light', icon: <IconSun size={15} /> },
						{ value: 'dark', label: 'Dark', icon: <IconMoon size={15} /> },
					]}
				/>
			</section>

			<section className="settings-section" aria-labelledby="set-about">
				<h3 id="set-about" className="settings-heading">This computer</h3>
				<dl className="status-list status-list-roomy">
					<div><dt>Local model</dt><dd>{MODEL.name} · {MODEL.quant} · {store.scenario.model === 'ready' ? 'Ready' : store.scenario.model === 'starting' ? 'Starting' : 'Not running'}</dd></div>
					<div><dt>Library</dt><dd>{enabled} of {store.docs.length} documents used for answers</dd></div>
					<div><dt>Network</dt><dd><IconLock size={13} /> Offline. Nothing leaves this computer.</dd></div>
				</dl>
			</section>
		</Dialog>
	);
}
