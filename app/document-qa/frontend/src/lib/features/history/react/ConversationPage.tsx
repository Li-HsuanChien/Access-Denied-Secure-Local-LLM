import { useEffect, useState } from 'react';
import { useServices } from '../../../../react/providers';
import { restoreConversation } from '../restoreConversation';
import type { ChatSession } from '../../react-contracts';
import { ChatPage } from '../../answering/react/ChatPage';

export function ConversationPage({ id }: { id: string }) {
 const services = useServices();
 const [session, setSession] = useState<ChatSession | null>(null);
 const [error, setError] = useState('');
 useEffect(() => {
  let active = true;
  void services.history.open(id).then(saved => {
   if (!active) return;
   if (!saved) throw new Error('This conversation is no longer available. Open another chat or start a new one.');
   setSession(restoreConversation(saved));
  }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not open this conversation.'); });
  return () => { active = false; };
 }, [id, services]);
 if (error) return <p role="alert">{error}</p>;
 return session ? <ChatPage initialSession={session} /> : <p role="status">Loading conversation…</p>;
}
