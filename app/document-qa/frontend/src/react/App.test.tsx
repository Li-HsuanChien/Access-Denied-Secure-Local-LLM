import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Answer, AppServices } from '../lib/features/react-contracts';
import { createAppRuntime, type AppRuntime } from './providers';
import App from './App';

const runtimes: AppRuntime[] = [];
function runtimeFor(browser: Window): AppRuntime {
	let id = 0;
	const services = {
		createId: () => `routed-${++id}`,
		now: () => Date.now(),
		answering: {
			ask: vi.fn(async (question: string) => answerFor(question)),
			health: async () => ({
				ready: true,
				library: { document_count: 1, chunk_count: 2 },
				answering: { ready: true }
			})
		},
		settings: {
			read: async () => ({ general_knowledge: true }),
			update: async ({ general_knowledge }: { general_knowledge: boolean }) => ({ general_knowledge })
		},
		history: { enabled: async () => true, list: async () => [], save: vi.fn(async () => true), setEnabled: vi.fn(async (value: boolean) => value) },
		library: { versions: async () => ({ versions: [] }) }
	} as unknown as AppServices;
	const runtime = createAppRuntime(services, browser);
	runtimes.push(runtime);
	return runtime;
}

function answerFor(question: string): Answer {
	return { schema_version: '1.0.0', request_id: `answer-${question}`, question, status: 'answered', evidence_mode: 'none',
		documents: [], citations: [], evidence: [], general_knowledge: `Answer for ${question}`, limitations: [], warnings: [],
		model: null, collection_version: null, prompt_version: 'routed-test', error: null,
		timing: { retrieval_ms: 0, generation_ms: 0, total_ms: 0, attempts: 1, prompt_tokens: null, completion_tokens: null } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function submit(question: string) {
	const input = screen.getByLabelText('Ask a question about your library…');
	input.textContent = question; fireEvent.input(input); fireEvent.keyDown(input, { key: 'Enter' });
}
afterEach(() => { cleanup(); runtimes.splice(0).forEach(runtime => runtime.library.dispose()); vi.restoreAllMocks(); });
beforeEach(() => {
	window.history.replaceState({}, '', '/');
	localStorage.clear();
	Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
	window.matchMedia = vi.fn().mockReturnValue({
		matches: false,
		addEventListener() {},
		removeEventListener() {}
	});
});
describe('routed workflow lifetime', () => {
	it('StrictMode mounts no answer, and same-root New Chat clears an existing graph and draft', async () => {
		const runtime = runtimeFor(window);
		render(<StrictMode><App runtime={runtime} /></StrictMode>);
		expect(runtime.services.answering.ask).not.toHaveBeenCalled();
		submit('first'); await screen.findByText('Answer for first');
		const input = screen.getByLabelText('Ask a question about your library…'); input.textContent = 'draft'; fireEvent.input(input);
		fireEvent.click(screen.getByRole('link', { name: 'New Chat' }));
		expect(window.location.pathname).toBe('/');
		expect(screen.getByLabelText('Ask a question about your library…').textContent).toBe('');
		expect(screen.queryByText('Answer for first')).toBeNull();
		expect(runtime.services.answering.ask).toHaveBeenCalledTimes(1);
	});
	it('route exit discards old queued questions, while a new session waits for detached answer and save', async () => {
		const runtime = runtimeFor(window), first = deferred<Answer>(), saved = deferred<boolean>();
		runtime.services.answering.ask = vi.fn().mockReturnValueOnce(first.promise).mockImplementation(async (question: string) => answerFor(question));
		runtime.services.history.save = vi.fn().mockReturnValueOnce(saved.promise).mockResolvedValue(true);
		render(<App runtime={runtime} />);
		submit('old'); submit('discard old queued');
		fireEvent.click(screen.getByRole('link', { name: 'History' })); await screen.findByRole('heading', { name: 'History' });
		fireEvent.click(screen.getByRole('link', { name: 'New Chat' })); submit('new');
		expect(runtime.services.answering.ask).toHaveBeenCalledTimes(1);
		await act(async () => { first.resolve(answerFor('old')); });
		expect(runtime.services.history.save).not.toHaveBeenCalled();
		await act(async () => { saved.resolve(true); });
		await screen.findByText('Answer for new');
		expect(screen.queryByText('Answer for old')).toBeNull();
		expect(runtime.services.answering.ask).toHaveBeenNthCalledWith(2, 'new', true, expect.any(String));
		expect(runtime.services.answering.ask).toHaveBeenCalledTimes(2);
		expect(runtime.services.history.save).not.toHaveBeenCalled();
	});
	it('Header and Settings keep their committed preference while a write is pending or rejected', async () => {
		window.history.replaceState({}, '', '/settings');
		const runtime = runtimeFor(window), write = deferred<{ general_knowledge: boolean }>();
		runtime.services.settings.update = vi.fn().mockReturnValueOnce(write.promise).mockRejectedValueOnce(new Error('write rejected'));
		render(<App runtime={runtime} />);
		const header = screen.getByRole('switch', { name: 'Include general model knowledge' }) as HTMLInputElement;
		const settings = screen.getByRole('switch', { name: /Include general model knowledge by default/ }) as HTMLInputElement;
		fireEvent.click(settings);
		await waitFor(() => expect(runtime.services.settings.update).toHaveBeenCalledTimes(1));
		expect(header.checked).toBe(true); expect(settings.checked).toBe(true);
		await act(async () => { write.resolve({ general_knowledge: false }); });
		expect(header.checked).toBe(false); expect(settings.checked).toBe(false);
		fireEvent.click(settings); await screen.findByText('write rejected');
		expect(header.checked).toBe(false); expect(settings.checked).toBe(false);
	});
	it('a history save failure leaves the routed answer visible and permits the next question', async () => {
		const runtime = runtimeFor(window);
		runtime.services.answering.ask = vi.fn().mockResolvedValueOnce({ ...answerFor('retained'), warnings: [{ code: 'history_save_failed', message: 'This answer is available here, but could not be saved to local history.' }] }).mockImplementation(async (question: string) => answerFor(question));
		render(<App runtime={runtime} />); submit('retained');
		await screen.findByText('Answer for retained');
		expect(screen.getAllByText(/This answer is available here, but could not be saved/).length).toBeGreaterThan(0);
		submit('recovery'); await screen.findByText('Answer for recovery');
		expect(runtime.services.answering.ask).toHaveBeenCalledTimes(2);
		expect(runtime.services.history.save).not.toHaveBeenCalled();
	});
});

describe('React routes inside the application shell', () => {
	it.each([
		['/', 'Chat'],
		['/qa', 'Chat'],
		['/library', 'Library'],
		['/history', 'History'],
		['/settings', 'Settings']
	])('renders the %s route as %s', (path, title) => {
		window.history.replaceState({}, '', path);
		render(<App runtime={runtimeFor(window)} />);
		expect(screen.getByRole('main')).toBeTruthy();
		if (title === 'Chat') {
			expect(screen.getByLabelText('Ask a question about your library…')).toBeTruthy();
		} else {
			expect(screen.getByRole('heading', { name: title })).toBeTruthy();
		}
	});
});
