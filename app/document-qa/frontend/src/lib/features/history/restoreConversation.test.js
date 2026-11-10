import { it, expect } from 'vitest';
import { restoreConversation } from './restoreConversation';
import { createFixtureAnsweringClient } from '../answering/fixtureAnsweringClient';
it('restores every turn, original validated answers and the room identity', async () => {
 const answer = await createFixtureAnsweringClient({ delay: 0 }).ask('Question');
 const history = restoreConversation({ conversation_id: 'room', messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: '', answer }, { role: 'user', content: 'Next' }] });
 expect(history.id).toBe('room');
 expect(history.currentId).toBe('saved-2');
 expect(history.messages['saved-1'].childIds).toEqual(['saved-2']);
 expect(history.messages['saved-1'].answer.collection_version).toBe('fixture');
 expect(history.messages['saved-1'].content).toContain('[1]');
});
it('rejects malformed saved answers and unrecognized roles', () => {
 expect(() => restoreConversation({ conversation_id: 'room', messages: [{ role: 'assistant', answer: {} }] })).toThrow('incompatible');
 expect(() => restoreConversation({ conversation_id: 'room', messages: [{ role: 'system', content: 'bad' }] })).toThrow('incompatible');
});
it('allows an empty thread without inventing messages', () => {
 expect(restoreConversation({ conversation_id: 'room', messages: [] })).toMatchObject({ id: 'room', messages: {}, currentId: null });
});
it('reads stored SQLite timestamps as UTC', () => {
 const history = restoreConversation({ conversation_id: 'room', messages: [{ role: 'user', content: 'Q', created_at: '2026-11-10 14:00:00' }, { role: 'user', content: 'R', created_at: 'not a date' }] });
 expect(history.messages['saved-0'].createdAt).toBe(Date.UTC(2026, 10, 10, 14, 0, 0));
 expect(history.messages['saved-1'].createdAt).toBe(0);
});
