/*
 * SIMULATED host. Stands in for the loopback host operations the production
 * app already calls (answering.ask, settings.update, history.*, library.*),
 * with realistic delays and switchable failures from the Prototype panel.
 */
import { route, type Phase, type Reply } from '../data/samples';

export interface Scenario {
	model: 'ready' | 'starting' | 'unavailable';
	answerFails: boolean;
	historyFails: boolean;
	settingsFail: boolean;
	publishFails: boolean;
	fast: boolean;
}

export const defaultScenario: Scenario = { model: 'ready', answerFails: false, historyFails: false, settingsFail: false, publishFails: false, fast: false };

export const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
	const timer = setTimeout(resolve, ms);
	signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
});

export class HostError extends Error {}

export async function ask(
	question: string,
	opts: { generalKnowledge: boolean; enabledDocs: Set<string>; scenario: Scenario; onPhase: (phase: Phase, passages?: number) => void },
): Promise<Reply> {
	const k = opts.scenario.fast ? 0.25 : 1;
	opts.onPhase('searching');
	await wait(1100 * k);
	const reply = route(question, opts.generalKnowledge, opts.enabledDocs);
	if (reply.citations.length) {
		opts.onPhase('reading', Math.max(reply.citations.length + 1, 3));
		await wait(1200 * k);
	}
	opts.onPhase('writing');
	await wait(1500 * k);
	if (opts.scenario.answerFails) throw new HostError('The local model stopped responding before the answer was finished.');
	return reply;
}

export async function saveSetting(scenario: Scenario): Promise<void> {
	await wait(scenario.fast ? 150 : 550);
	if (scenario.settingsFail) throw new HostError('The setting couldn’t be saved.');
}

export async function quickOp(scenario: Scenario, ms = 500): Promise<void> {
	await wait(scenario.fast ? ms / 4 : ms);
}
