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
