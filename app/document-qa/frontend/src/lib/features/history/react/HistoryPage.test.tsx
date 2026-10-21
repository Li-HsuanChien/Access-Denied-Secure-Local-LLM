import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices } from '../../../../react/providers';
import type { SavedConversation } from '../../react-contracts';
import { HistoryPage } from './HistoryPage';

const row: SavedConversation = { conversation_id: 'answer-1', title: 'What is the result?', updated_at: '2026-10-20 10:15', model_id: 'local-model-v2', collection_version: 'v0004' };
const record = {
  ...row,
  answer: {
    schema_version: '1.0.0', request_id: 'answer-1', question: 'What is the result?', status: 'answered', evidence_mode: 'text',
    documents: [{ text: 'The result is 42.', citation_ids: ['S1'] }], general_knowledge: 'A supporting note.', limitations: ['Limited sample.'],
    citations: [{ citation_id: 'S1', document_title: 'Guide', source_filename: 'guide.pdf', page_start: 2, page_end: 3, quote: 'Result is 42.', document_id: 'doc_1234567890abcdef12345678', chunk_ids: ['chk_1234567890abcdef12345678'], char_start: 0, char_end: 12, text_checksum_sha256: '0'.repeat(64), evidence_type: 'text', score: 0.9, rank: 1, pages: [{ page_number: 2, page_char_start: 0, page_char_end: 12, highlight_rects: [], coordinates_reliable: false, page_width: 612, page_height: 792 }] }],
    warnings: [], error: null, evidence: [], model: { model_id: 'local-model-v2', name: 'Local model', quant: null, api_version: null, runtime_version: null, stub: false },
    collection_version: 'v0004', prompt_version: 'prompt-1', timing: { retrieval_ms: 1, generation_ms: 2, total_ms: 3, attempts: 1, prompt_tokens: null, completion_tokens: null }
  }
};
function mount() {
  const services = createDefaultServices();
  services.history.list = vi.fn(async () => [row]);
  services.history.open = vi.fn(async () => record);
  services.history.remove = vi.fn(async () => true);
  services.history.clear = vi.fn(async () => undefined);
  services.history.enabled = vi.fn(async () => true);
  services.history.setEnabled = vi.fn(async value => value);
  services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
  services.settings.update = vi.fn(async value => value);
  services.answering.health = vi.fn(async () => ({ ready: true } as any));
  const runtime = createAppRuntime(services, window);
  render(<AppProviders runtime={runtime}><HistoryPage /></AppProviders>);
  return runtime;
}
beforeEach(() => { window.history.replaceState(null, '', '/history'); });
afterEach(cleanup);

it('lists saved records and opens a plain claims and native source-details view', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  fireEvent.click(screen.getByRole('button', { name: /^What is the result\? 2026-10-20/ }));
  await screen.findByText('From your documents');
  expect(screen.getByText('The result is 42.')).toBeTruthy();
  expect(screen.getByText('S1')).toBeTruthy();
  expect(screen.getByText('General model knowledge')).toBeTruthy();
  expect(screen.getByText('A supporting note.')).toBeTruthy();
  expect(screen.getByText('Limitations')).toBeTruthy();
  expect(screen.getByText('Sources')).toBeTruthy();
  expect(screen.getByText('Guide · pages 2–3')).toBeTruthy();
  expect(runtime.services.history.open).toHaveBeenCalledWith('answer-1');
  expect(screen.queryByRole('article')).toBeNull();
});

it('rejects malformed stored answers and keeps the original open failure notice', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  runtime.services.history.open = vi.fn(async () => ({ ...record, answer: { question: 'untrusted' } }));
  fireEvent.click(screen.getByRole('button', { name: /^What is the result\? 2026-10-20/ }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('The local service returned an incompatible response.');
  expect(screen.queryByText('untrusted')).toBeNull();
});

it('deletes the selected record and clears its detail view', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  fireEvent.click(screen.getByRole('button', { name: /^What is the result\? 2026-10-20/ }));
  await screen.findByText('From your documents');
  fireEvent.click(screen.getByRole('button', { name: 'Delete What is the result?' }));
  await screen.findByText('Conversation deleted.');
  expect(screen.queryByText('From your documents')).toBeNull();
});

it('clears history only after native confirmation', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Clear all history' }));
  expect(confirm).toHaveBeenCalledWith('Delete all saved conversations from this computer?');
  expect(runtime.services.history.clear).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear all history' }));
  await waitFor(() => expect(runtime.services.history.clear).toHaveBeenCalledTimes(1));
});

it('commits history persistence through the shared preference provider', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  fireEvent.click(screen.getByRole('switch', { name: 'Save new answers to local history' }));
  await screen.findByText('New answers will not be saved.');
  expect(runtime.preferences.getSnapshot().historyEnabled).toBe(false);
  expect(runtime.services.history.setEnabled).toHaveBeenCalledWith(false);
});


it('ignores a stale open that resolves after a newer open or selected-record deletion', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('button', { name: /^A second answer/ });
  fireEvent.click(screen.getByRole('button', { name: /^What is the result\? 2026-10-20/ }));
  fireEvent.click(screen.getByRole('button', { name: /^A second answer/ }));
  resolveSecond({ ...record, ...other, answer: { ...record.answer, question: 'Second answer is current.' } });
  await screen.findByText('Second answer is current.');
  resolveFirst(record);
  await waitFor(() => expect(screen.getByText('Second answer is current.')).toBeTruthy());
  expect(runtime.services.history.open).toHaveBeenCalledTimes(2);
});


it('does not resurrect an open result after the record is deleted', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  let resolveOpen!: (value: Record<string, unknown>) => void;
  runtime.services.history.open = vi.fn(() => new Promise(resolve => { resolveOpen = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: /^What is the result\? 2026-10-20/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete What is the result?' }));
  resolveOpen(record);
  await screen.findByText('Conversation deleted.');
  expect(screen.queryByText('From your documents')).toBeNull();
  expect(runtime.services.history.remove).toHaveBeenCalledWith('answer-1');
});

it('does not restore a deleted row from a list request that was already in flight', async () => {
  const runtime = mount();
  await screen.findByText('What is the result?');
  let resolveList!: (value: SavedConversation[]) => void;
  runtime.services.history.list = vi.fn(() => new Promise(resolve => { resolveList = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete What is the result?' }));
  await screen.findByText('Conversation deleted.');
  resolveList([row]);
  await waitFor(() => expect(screen.getByText('No saved conversations yet.')).toBeTruthy());
  expect(screen.queryByRole('button', { name: /^What is the result\? 2026-10-20/ })).toBeNull();
});
