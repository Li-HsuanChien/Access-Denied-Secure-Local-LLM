import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import AnsweringView from './AnsweringView.svelte';
import { createFixtureAnsweringClient } from './fixtureAnsweringClient';
import { workspaceVoice } from '../personality/presentation';

let component;
afterEach(async () => { if (component) await unmount(component); document.body.innerHTML = ''; });
async function render(client = createFixtureAnsweringClient({ delay: 0 })) {
	component = mount(AnsweringView, { target: document.body, props: { client } });
	await tick();
	await vi.waitFor(() => expect(document.body.textContent).not.toContain('Checking the local service'));
	return client;
}
function submit(text) {
	const input = document.querySelector('textarea');
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
}
async function answered(text = 'What does the guide say?') {
	submit(text);
	await vi.waitFor(() => expect(document.querySelector('textarea').disabled).toBe(false));
}

describe('AnsweringView public interface', () => {
	it('renders answer sections and an expandable source passage', async () => {
		await render(); await answered();
		expect(document.body.textContent).toContain('From your documents');
		expect(document.body.textContent).toContain(workspaceVoice.generalKnowledgeNotice);
		const source = document.querySelector('details');
		expect(source.open).toBe(false);
		source.querySelector('summary').click();
		expect(source.open).toBe(true);
		expect(source.textContent).toContain('SUPPORTING PASSAGE');
	});
	it('keeps only one question in flight and sends the general-knowledge preference', async () => {
		const client = createFixtureAnsweringClient({ delay: 100 });
		const ask = vi.spyOn(client, 'ask');
		await render(client);
		document.querySelector('input[type=checkbox]').click();
		submit('First question'); submit('Second question');
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith('First question', false);
		expect(document.querySelector('textarea').disabled).toBe(true);
		await vi.waitFor(() => expect(document.querySelector('textarea').disabled).toBe(false));
		expect(document.body.textContent).not.toContain('General model knowledge');
	});
	it.each(['unknown topic', 'busy', 'fail', 'warning'])('shows the %s state and retains the question', async (question) => {
		await render(); await answered(question);
		expect(document.querySelector('textarea').value).toBe(question);
		const expected = { 'unknown topic': 'enough evidence', busy: 'Another question is running', fail: 'took too long', warning: 'unsupported claims were withheld' };
		expect(document.body.textContent).toContain(expected[question]);
	});
	it('disables answering when the local model is degraded', async () => {
		await render(createFixtureAnsweringClient({ degraded: true }));
		expect(document.body.textContent).toContain('Workspace needs attention');
		expect(document.querySelector('textarea').disabled).toBe(true);
	});
	it('announces completion and warnings for screen readers', async () => {
		await render(); await answered('warning');
		expect(document.querySelector('[aria-live=polite]').textContent).toContain('Answer ready');
		expect(document.querySelector('[role=alert]').textContent).toContain('unsupported claims were withheld');
	});
	it('renders repeated claim text without duplicate-key failures', async () => {
		const client = createFixtureAnsweringClient({ delay: 0 });
		const ask = client.ask;
		client.ask = async (...args) => { const result = await ask(...args); return { ...result, documents: [...result.documents, ...result.documents] }; };
		await render(client); await answered();
		expect(document.querySelectorAll('.claim')).toHaveLength(2);
	});
	it('submits with Enter and keeps Shift+Enter for a new line', async () => {
		const client = createFixtureAnsweringClient({ delay: 0 });
		const ask = vi.spyOn(client, 'ask');
		await render(client);
		const input = document.querySelector('textarea');
		input.value = 'Keyboard question'; input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
		expect(ask).not.toHaveBeenCalled();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(ask).toHaveBeenCalledWith('Keyboard question', true));
		await vi.waitFor(() => expect(document.body.textContent).toContain('Answer ready'));
		expect(document.activeElement).toBe(input);
	});
	it('shows transport failure as an alert and allows retry with the preserved question', async () => {
		const client = createFixtureAnsweringClient({ delay: 0 });
		const originalAsk = client.ask;
		client.ask = vi.fn().mockRejectedValueOnce(new Error('Start the local QA service.')).mockImplementation(originalAsk);
		await render(client); await answered('Keep this question');
		expect(document.querySelector('[role=alert]').textContent).toContain('Start the local QA service');
		expect(document.querySelector('textarea').value).toBe('Keep this question');
		await answered('Keep this question');
		expect(document.body.textContent).toContain('From your documents');
	});
});
