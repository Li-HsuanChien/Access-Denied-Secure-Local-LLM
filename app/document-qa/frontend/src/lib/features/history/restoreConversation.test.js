import { describe, it, expect } from 'vitest';
import { restoreConversation } from './restoreConversation';

describe('restoring saved threads', () => {
 it('preserves every turn, parent links, and source version for resumed chats', () => {
  const answer = { question: 'Question', status: 'answered', documents: [], general_knowledge: 'Answer', limitations: [], warnings: [], collection_version: 'v001', citations: [{ citation_id: 'c1', document_id: 'doc_123', document_title: 'Manual', page_start: 3, page_end: 3, quote: 'Evidence', pages: [] }] };
  const history = restoreConversation({ messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: '', answer }, { role: 'user', content: 'Follow up' }, { role: 'assistant', content: 'Second answer' }] });
  expect(Object.keys(history.messages)).toHaveLength(4);
  expect(history.currentId).toBe('saved-3');
  expect(history.messages['saved-2'].parentId).toBe('saved-1');
  expect(history.messages['saved-1'].childrenIds).toEqual(['saved-2']);
  expect(history.messages['saved-1'].content).toContain('Answer');
  expect(history.messages['saved-1'].citations[0].metadata[0]).toMatchObject({ document_id: 'doc_123', version: 'v001', page: 2 });
  expect(history.messages['saved-3'].done).toBe(true);
 });
 it('allows an empty thread without inventing messages', () => {
  expect(restoreConversation({ messages: [] })).toEqual({ messages: {}, currentId: null });
 });
});
