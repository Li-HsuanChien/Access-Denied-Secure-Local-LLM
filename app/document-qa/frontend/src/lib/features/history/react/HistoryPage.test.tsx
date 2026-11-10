import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import type { SavedConversation } from '../../react-contracts';
import { HistoryPage } from './HistoryPage';

const row: SavedConversation = { conversation_id: 'answer-1', title: 'What is the result?', updated_at: '2026-10-20 10:15', model_id: 'local-model-v2', collection_version: 'v0004' };
const answer = {
  schema_version: '1.0.0', request_id: 'answer-1', question: 'What is the result?', status: 'answered', evidence_mode: 'text',
  documents: [{ text: 'The result is 42.', citation_ids: ['S1'] }], general_knowledge: 'A supporting note.', limitations: ['Limited sample.'],
  citations: [{ citation_id: 'S1', document_title: 'Guide', source_filename: 'guide.pdf', page_start: 2, page_end: 3, quote: 'Result is 42.', document_id: 'doc_1234567890abcdef12345678', chunk_ids: ['chk_1234567890abcdef12345678'], char_start: 0, char_end: 12, text_checksum_sha256: '0'.repeat(64), evidence_type: 'text', score: 0.9, rank: 1, pages: [{ page_number: 2, page_char_start: 0, page_char_end: 12, highlight_rects: [], coordinates_reliable: false, page_width: 612, page_height: 792 }] }],
  warnings: [], error: null, evidence: [], model: { model_id: 'local-model-v2', name: 'Local model', quant: null, api_version: null, runtime_version: null, stub: false },
  collection_version: 'v0004', prompt_version: 'prompt-1', timing: { retrieval_ms: 1, generation_ms: 2, total_ms: 3, attempts: 1, prompt_tokens: null, completion_tokens: null }
};
const record = { ...row, answer };
function mount(historyEnabled = true) {
  const services = createDefaultServices();
  services.history.list = vi.fn(async () => [row]);
  services.history.open = vi.fn(async () => record);
  services.history.remove = vi.fn(async () => true);
  services.history.clear = vi.fn(async () => undefined);
  services.history.enabled = vi.fn(async () => historyEnabled);
  services.history.setEnabled = vi.fn(async value => value);
  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  services.settings.update = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => ({ ready: true } as any));
  const runtime = createAppRuntime(services, window);
  render(<AppProviders runtime={runtime}><HistoryPage /></AppProviders>);
  return runtime;
}
const item = (name: RegExp = /^What is the result\?/) => screen.getByRole('button', { name });
const detail = () => screen.getByRole('region', { name: 'What is the result?' });
async function confirmDelete() {
  fireEvent.click(within(detail()).getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete this conversation?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}
beforeEach(() => { window.history.replaceState(null, '', '/history'); });
afterEach(() => { cleanup(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });

it('lists saved records and opens a plain claims and native source-details preview with one basis label', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  expect(screen.getByRole('heading', { name: 'History', level: 1 })).toBeTruthy();
  fireEvent.click(item());
  const pane = await screen.findByRole('list', { name: 'Conversation preview' });
  await within(pane).findByText('Based on your documents');
  expect(within(pane).getByText('The result is 42.')).toBeTruthy();
  expect(within(pane).getByText('S1')).toBeTruthy();
  expect(screen.queryByText('General knowledge · no supporting documents')).toBeNull();
  expect(screen.queryByText('A supporting note.')).toBeNull();
  expect(within(pane).getByText('Limitations')).toBeTruthy();
  expect(within(pane).getByText('Sources')).toBeTruthy();
  expect(within(pane).getByText('Guide · pages 2–3')).toBeTruthy();
  expect(within(detail()).getByText(/1 question/)).toBeTruthy();
  expect(runtime.services.history.open).toHaveBeenCalledWith('answer-1');
  expect(screen.queryByRole('article')).toBeNull();
});

it('previews a saved thread transcript and continues it through the existing resume route', async () => {
  const runtime = mount();
  runtime.services.history.open = vi.fn(async () => ({ ...record, messages: [
    { role: 'user', content: 'First question?', answer: null, created_at: '2026-10-20 10:00' },
    { role: 'assistant', content: 'saved text', answer, created_at: '2026-10-20 10:00' },
    { role: 'user', content: 'Follow-up?', answer: null, created_at: '2026-10-20 10:01' },
    { role: 'assistant', content: 'General reply.', answer: { ...answer, documents: [], citations: [], limitations: [] }, created_at: '2026-10-20 10:01' }
  ] }));
  await screen.findByText('What is the result?');
  fireEvent.click(item());
  const pane = await screen.findByRole('list', { name: 'Conversation preview' });
  expect(within(pane).getByText('First question?')).toBeTruthy();
  expect(within(pane).getByText('Follow-up?')).toBeTruthy();
  expect(within(pane).getByText('Based on your documents')).toBeTruthy();
  expect(within(pane).getByText('General knowledge · no supporting documents')).toBeTruthy();
  expect(within(pane).getByText('A supporting note.')).toBeTruthy();
  expect(within(detail()).getByText(/2 questions/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue this chat' }));
  expect(window.location.pathname).toBe('/conversation/answer-1');
});

it('rejects malformed stored answers and keeps the original open failure notice', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  runtime.services.history.open = vi.fn(async () => ({ ...record, answer: { question: 'untrusted' } }));
  fireEvent.click(item());
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('The local service returned an incompatible response.');
  expect(screen.queryByText('untrusted')).toBeNull();
});

it('filters client-side by title and by content of chats already previewed, with a no-match state', async () => {
  const runtime = mount();
  runtime.services.history.list = vi.fn(async () => [row, { ...row, conversation_id: 'answer-2', title: 'Budget notes' }]);
  window.dispatchEvent(new Event('secure-qa-history-changed'));
  await screen.findByText('Budget notes');
  const search = screen.getByRole('searchbox', { name: 'Search chats' });
  expect(search.hasAttribute('data-shell-search')).toBe(true);
  fireEvent.change(search, { target: { value: 'budget' } });
  expect(screen.getByText('Budget notes')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^What is the result\?/ })).toBeNull();
  fireEvent.change(search, { target: { value: '42' } });
  expect((await screen.findByRole('status')).textContent).toBe('No chats match “42”.');
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.click(item());
  await screen.findByRole('list', { name: 'Conversation preview' });
  fireEvent.change(search, { target: { value: '42' } });
  expect(item()).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Budget notes/ })).toBeNull();
  expect(runtime.services.history.list).toHaveBeenCalled();
});

it('deletes the selected record only after confirmation and clears its preview', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  fireEvent.click(item());
  await screen.findByText('Based on your documents');
  fireEvent.click(within(detail()).getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete this conversation?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(runtime.services.history.remove).not.toHaveBeenCalled();
  await confirmDelete();
  await screen.findByText('Conversation deleted.');
  expect(screen.queryByText('Based on your documents')).toBeNull();
  expect(runtime.services.history.remove).toHaveBeenCalledWith('answer-1');
});

it('keeps the confirmation open with the host error when deletion fails', async () => {
  const runtime = mount();
  runtime.services.history.remove = vi.fn(async () => { throw new Error('Delete refused.'); });
  await screen.findByText('What is the result?');
  fireEvent.click(item());
  await screen.findByText('Based on your documents');
  await confirmDelete();
  const dialog = screen.getByRole('alertdialog');
  expect((await within(dialog).findByRole('alert')).textContent).toBe('Delete refused. Nothing was changed. Try again.');
  expect(item()).toBeTruthy();
});

it('ignores a stale open that resolves after a newer open', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  let resolveFirst!: (value: Record<string, unknown>) => void;
  let resolveSecond!: (value: Record<string, unknown>) => void;
  runtime.services.history.open = vi.fn((id: string) => new Promise(resolve => {
    if (id === 'answer-1') resolveFirst = resolve;
    else resolveSecond = resolve;
  }));
  const other = { ...row, conversation_id: 'answer-2', title: 'A second answer' };
  runtime.services.history.list = vi.fn(async () => [row, other]);
  window.dispatchEvent(new Event('secure-qa-history-changed'));
  await screen.findByRole('button', { name: /^A second answer/ });
  fireEvent.click(item());
  fireEvent.click(screen.getByRole('button', { name: /^A second answer/ }));
  resolveSecond({ ...record, ...other, answer: { ...answer, question: 'Second answer is current.' } });
  await screen.findByText('Second answer is current.');
  await act(async () => { resolveFirst(record); });
  expect(screen.getByText('Second answer is current.')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'What is the result?' })).toBeNull();
  expect(runtime.services.history.open).toHaveBeenCalledTimes(2);
});

it('does not resurrect an open result after the record is deleted', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  let resolveOpen!: (value: Record<string, unknown>) => void;
  runtime.services.history.open = vi.fn(() => new Promise(resolve => { resolveOpen = resolve; }));
  fireEvent.click(item());
  await screen.findByText('Loading preview…');
  await confirmDelete();
  await screen.findByText('Conversation deleted.');
  await act(async () => { resolveOpen(record); });
  expect(screen.queryByText('Based on your documents')).toBeNull();
  expect(runtime.services.history.remove).toHaveBeenCalledWith('answer-1');
});

it('does not restore a deleted row from a list request that was already in flight', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  fireEvent.click(item());
  await screen.findByText('Based on your documents');
  let resolveList!: (value: SavedConversation[]) => void;
  runtime.services.history.list = vi.fn(() => new Promise(resolve => { resolveList = resolve; }));
  window.dispatchEvent(new Event('secure-qa-history-changed'));
  await confirmDelete();
  await screen.findByText('Conversation deleted.');
  await act(async () => { resolveList([row]); });
  await screen.findByText('No saved chats yet');
  expect(screen.queryByRole('button', { name: /^What is the result\?/ })).toBeNull();
});

it('shows the history-off state from the shared preference provider with a route to Settings', async () => {
  mount(false);
  await screen.findByText('History is off. New chats aren’t saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  expect(window.location.pathname).toBe('/settings');
});

it('uses one column below 860px with a back button that returns focus to the chat', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
  mount();
  await screen.findByText('What is the result?');
  fireEvent.click(item());
  await screen.findByText('Based on your documents');
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement?.textContent).toBe('What is the result?');
  fireEvent.click(screen.getByRole('button', { name: 'All chats' }));
  expect(screen.getByRole('searchbox')).toBeTruthy();
  expect(document.activeElement).toBe(item());
});
