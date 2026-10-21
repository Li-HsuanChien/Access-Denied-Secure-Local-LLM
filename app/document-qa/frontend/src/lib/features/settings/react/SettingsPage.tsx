import { useCallback, useEffect, useRef, useState } from 'react';
import { usePreferences, useServices } from '../../../../react/providers';

function message(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

export function SettingsPage() {
	const services = useServices();
	const preferences = usePreferences();
	const [readiness, setReadiness] = useState('Checking local host…');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const writing = useRef(0);
	const ownWriteFailure = useRef<string | null>(null);
	const refresh = useCallback(async () => {
		ownWriteFailure.current = null;
		const [healthResult, preferenceResult] = await Promise.allSettled([services.answering.health(), preferences.refresh()]);
		if (healthResult.status === 'rejected') {
			const fallback = 'The local host could not be reached.';
			setReadiness(fallback);
			setError(message(healthResult.reason, fallback));
			return;
		}
		const state = preferenceResult.status === 'fulfilled' ? preferenceResult.value : preferences.state;
		const preferenceError = state.errors.generalKnowledge || state.errors.historyEnabled;
		if (preferenceResult.status === 'rejected' || preferenceError) {
			const fallback = 'The local host could not be reached.';
			setReadiness(fallback);
			setError(preferenceResult.status === 'rejected' ? message(preferenceResult.reason, fallback) : preferenceError || fallback);
			return;
		}
		const health = healthResult.value;
		setReadiness(`${health.ready ? 'Ready' : 'Needs attention'} · ${health.library.document_count} ${health.library.document_count === 1 ? 'document' : 'documents'} · ${health.answering.ready ? 'local model ready' : health.answering.error?.message || 'local model unavailable'}`);
	}, [preferences.refresh, services.answering]);

	useEffect(() => {
		document.title = 'Settings · Access Denied';
		void refresh();
	}, [refresh]);

	useEffect(() => {
		const preferenceError = preferences.state.errors.generalKnowledge || preferences.state.errors.historyEnabled;
		if (!preferenceError || writing.current || preferenceError === ownWriteFailure.current) return;
		const fallback = 'The local host could not be reached.';
		setReadiness(fallback);
		setError(preferenceError || fallback);
	}, [preferences.state.errors]);

	async function knowledge(value: boolean) {
		writing.current += 1;
		try {
			await preferences.setGeneralKnowledge(value);
			setNotice('General knowledge preference saved and used for new questions.');
		} catch (cause) {
			ownWriteFailure.current = message(cause, 'Could not save this preference.');
			setError(ownWriteFailure.current);
		} finally {
			writing.current -= 1;
		}
	}

	async function historySetting(value: boolean) {
		writing.current += 1;
		try {
			const enabled = await preferences.setHistoryEnabled(value);
			setNotice(enabled ? 'New answers will be saved.' : 'New answers will not be saved.');
		} catch (cause) {
			ownWriteFailure.current = message(cause, 'Could not save this preference.');
			setError(ownWriteFailure.current);
		} finally {
			writing.current -= 1;
		}
	}

	return (
		<div className="workspace-page" aria-labelledby="title">
			<p className="eyebrow">Local preferences</p>
			<h1 id="title">Settings</h1>
			<p className="lede">These controls apply to local question answering and conversation history.</p>

			<section className="panel" aria-labelledby="answering-title">
				<h2 id="answering-title">Answering</h2>
				<label className="setting"><span className="grow"><span className="name">Include general model knowledge by default</span><span className="hint">Document answers remain evidence-grounded. General knowledge is labeled and uncited.</span></span><span className="workspace-switch"><input type="checkbox" role="switch" checked={preferences.state.generalKnowledge} onChange={(event) => void knowledge(event.currentTarget.checked)} /></span></label>
			</section>
			<section className="panel" aria-labelledby="privacy-title">
				<h2 id="privacy-title">Privacy and history</h2>
				<label className="setting"><span className="grow"><span className="name">Save new answers to local conversation history</span><span className="hint">Saved data stays on this computer and relies on operating-system disk encryption.</span></span><span className="workspace-switch"><input type="checkbox" role="switch" checked={preferences.state.historyEnabled} onChange={(event) => void historySetting(event.currentTarget.checked)} /></span></label>
			</section>
			<section className="panel" aria-labelledby="readiness-title">
				<div className="heading"><h2 id="readiness-title">Local readiness</h2><button className="btn quiet" type="button" onClick={() => void refresh()}>Refresh status</button></div>
				<p className="hint" role="status">{readiness}</p>
			</section>
			{notice && <p role="status" className="message notice">{notice}</p>}
			{error && <p role="alert" className="message error">{error}</p>}
		</div>
	);
}
