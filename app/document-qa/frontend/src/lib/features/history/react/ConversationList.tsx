import { useCallback, useEffect, useState } from 'react';
import { useNavigation, useServices, useAnswering } from '../../../../react/providers';
import type { SavedConversation } from '../historyClient';

export function ConversationList({ onSelect }: { onSelect: () => void }) {
 const services = useServices();
 const { state: answeringState } = useAnswering();
 const { route, navigate } = useNavigation();
 const [rows, setRows] = useState<SavedConversation[]>([]);
 const [error, setError] = useState('');
 const [revision, setRevision] = useState(0);
 const refresh = useCallback(() => setRevision(n => n + 1), []);
 useEffect(() => {
  let active = true;
  void services.history.list().then(result => { if (active) { setRows(result); setError(''); } })
   .catch(() => { if (active) setError('Could not load chats.'); });
  return () => { active = false; };
 }, [services, revision]);
 useEffect(() => {
  window.addEventListener('secure-qa-history-changed', refresh);
  return () => window.removeEventListener('secure-qa-history-changed', refresh);
 }, [refresh]);
 async function remove(row: SavedConversation) {
  if (answeringState.pending?.sessionId === row.conversation_id) return;
  if (!window.confirm(`Delete "${row.title}" from this computer?`)) return;
  try {
   await services.history.remove(row.conversation_id);
   window.dispatchEvent(new Event('secure-qa-history-changed'));
   if (route.path === `/conversation/${encodeURIComponent(row.conversation_id)}`) navigate('/', { newChat: true });
  } catch { setError('Could not delete this chat. Try again.'); }
 }
 return <section aria-label="Saved chats" className="saved-chats">
  <div className="heading"><h2>Chats</h2><button type="button" aria-label="Refresh saved chats" onClick={refresh}>Refresh</button></div>
  {error && <p role="alert">{error}</p>}
  {!rows.length && !error && <p>Your saved conversations will appear here.</p>}
  <ul>{rows.map(row => {
   const path = `/conversation/${encodeURIComponent(row.conversation_id)}` as const;
   return <li key={row.conversation_id}><a href={path} aria-current={route.path === path ? 'page' : undefined} title={row.title} onClick={event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(path); onSelect();
   }}>{row.title}</a><button type="button" aria-label={`Delete ${row.title}`} disabled={answeringState.pending?.sessionId === row.conversation_id} onClick={() => void remove(row)}>×</button></li>;
  })}</ul>
 </section>;
}
