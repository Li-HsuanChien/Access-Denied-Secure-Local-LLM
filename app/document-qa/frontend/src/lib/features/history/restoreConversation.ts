import type { ChatSession, ChatMessage } from '../react-contracts';
import { readAnswer } from '../../../react/providers/history';
import { formatAnswerForChat } from '../answering/react/chatController';
import { ClientError } from '../answering/answeringClient';

/** Rebuild the React graph; validate every stored answer before rendering. */
export function restoreConversation(saved: Record<string, unknown>): ChatSession {
 const invalid = () => new ClientError('invalid_response', 'The local service returned an incompatible response.');
 if (typeof saved.conversation_id !== 'string' || !Array.isArray(saved.messages)) throw invalid();
 const messages: Record<string, ChatMessage> = {};
 let currentId: string | null = null;
 for (const [index, value] of saved.messages.entries()) {
  if (!value || typeof value !== 'object') throw invalid();
  const turn = value as Record<string, unknown>;
  if (!['user', 'assistant'].includes(String(turn.role)) || typeof turn.content !== 'string') throw invalid();
  const id = `saved-${index}`;
  const answer = turn.answer == null ? null : readAnswer(turn.answer);
  const base = { id, parentId: currentId, childIds: [], createdAt: Date.parse(String(turn.created_at)) || 0, content: answer ? formatAnswerForChat(answer) : turn.content };
  messages[id] = turn.role === 'user' ? { ...base, role: 'user' } : {
   ...base, role: 'assistant', status: answer?.status === 'failed' ? 'error' : 'complete',
   answer, error: answer?.error?.message ?? null, historyWarning: null
  };
  if (currentId) messages[currentId] = { ...messages[currentId], childIds: [id] };
  currentId = id;
 }
 return { id: saved.conversation_id, messages, currentId, draft: '', queue: [] };
}
