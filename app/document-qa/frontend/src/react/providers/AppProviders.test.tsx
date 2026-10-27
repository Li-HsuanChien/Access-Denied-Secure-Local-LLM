import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppProviders, createAppRuntime, createDefaultServices, useAnswering, usePreferences } from './AppProviders';
import { readSavedAnswer } from './history';
import { createFixtureAnsweringClient } from '../../lib/features/answering/fixtureAnsweringClient';
import type { Answer } from '../../lib/features/answering/types';

afterEach(() => { cleanup(); });
function runtime() {
	const services = createDefaultServices();
	services.settings.read = vi.fn(async () => ({ general_knowledge: true }));
	services.settings.update = vi.fn(async (value) => value);
	services.history.enabled = vi.fn(async () => true);
	services.history.save = vi.fn(async () => true);
	return createAppRuntime(services, window);
}
function PreferenceConsumer({ name }: { name: string }) {
	const { state, setGeneralKnowledge } = usePreferences();
	return <button onClick={() => { void setGeneralKnowledge(false); }}>{name}: {String(state.generalKnowledge)}</button>;
}
it('publishes successful preferences to every mounted consumer', async () => {
	const app = runtime();
	render(<AppProviders runtime={app}><PreferenceConsumer name="Header" /><PreferenceConsumer name="Settings" /></AppProviders>);
	await waitFor(() => expect(app.preferences.getSnapshot().loaded.generalKnowledge).toBe(true));
	fireEvent.click(screen.getByText('Header: true'));
	await waitFor(() => expect(screen.getByText('Settings: false')).toBeTruthy());
	expect(screen.getByText('Header: false')).toBeTruthy();
});
function PendingConsumer() {
	return <span>{useAnswering().state.pending ? 'pending' : 'idle'}</span>;
}
it('a provider remount observes the same pending request and saves only once', async () => {
	const app = runtime();
	let resolve!: (answer: Answer) => void;
	app.services.answering.ask = vi.fn(() => new Promise((yes) => { resolve = yes; }));
	const request = app.answering.ask({ sessionId: 'old', question: 'Question', generalKnowledge: false });
	const first = render(<AppProviders runtime={app}><PendingConsumer /></AppProviders>);
	expect(screen.getByText('pending')).toBeTruthy();
	first.unmount();
	render(<AppProviders runtime={app}><PendingConsumer /></AppProviders>);
	expect(screen.getByText('pending')).toBeTruthy();
	await expect(app.answering.ask({ sessionId: 'new', question: 'Second', generalKnowledge: true })).rejects.toThrow('Another question');
	const answer = await createFixtureAnsweringClient({ delay: 0 }).ask('Question', false);
	resolve(answer);
	await request;
	await waitFor(() => expect(screen.getByText('idle')).toBeTruthy());
	expect(app.services.history.save).toHaveBeenCalledTimes(1);
});
it('validates saved answers with the complete backend schema', async () => {
	const answer = await createFixtureAnsweringClient({ delay: 0 }).ask('Question', false);
	const record = { conversation_id: 'saved', title: 'Question', updated_at: '2026-10-20',
		model_id: null, collection_version: 'fixture', answer };
	const before = structuredClone(record), loaded = readSavedAnswer(record);
	expect(loaded?.answer.timing).toEqual(answer.timing);
	expect(loaded?.answer).not.toBe(record.answer);
	expect(record).toEqual(before);
	expect(() => readSavedAnswer({ ...record, answer: { ...answer, timing: undefined } })).toThrow('incompatible response');
	expect(readSavedAnswer(null)).toBeNull();
});
