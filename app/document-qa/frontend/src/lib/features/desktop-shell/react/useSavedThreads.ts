import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../../../react/providers';
import type { SavedConversation } from '../../history/historyClient';

/** Fired (on window) by anything that changes saved history; the sidebar re-reads history.list. */
export const HISTORY_CHANGED_EVENT = 'secure-qa-history-changed';
export const notifyHistoryChanged = () => window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));

/** Saved threads via the existing History interface (`history.list`); no new host operation. */
export function useSavedThreads() {
	const services = useServices();
	const [rows, setRows] = useState<SavedConversation[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState('');
	const [revision, setRevision] = useState(0);
	const refresh = useCallback(() => setRevision(n => n + 1), []);
	useEffect(() => {
		let active = true;
		void services.history.list().then(result => { if (active) { setRows(result); setError(''); setLoaded(true); } })
			.catch(() => { if (active) { setError('Couldn’t load your chats.'); setLoaded(true); } });
		return () => { active = false; };
	}, [services, revision]);
	useEffect(() => {
		window.addEventListener(HISTORY_CHANGED_EVENT, refresh);
		return () => window.removeEventListener(HISTORY_CHANGED_EVENT, refresh);
	}, [refresh]);
	return { rows, loaded, error, refresh };
}
