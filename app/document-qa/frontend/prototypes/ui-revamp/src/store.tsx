/*
 * Prototype application state. In production these responsibilities belong to
 * the existing providers (answering coordinator, preferences, library
 * coordinator, history). Here they are in-memory and driven by the simulated host.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Citation } from '$lib/features/answering/types';
import { sampleConversations, sampleLibrary, titleFrom, uid, type Conversation, type LibraryDoc, type Message } from './data/samples';
import { ask as hostAsk, defaultScenario, quickOp, saveSetting, wait, type Scenario } from './sim/host';
import { reviewFile, type ReviewFile } from './sim/review';
import { useToast } from './ui/toast';

export type View = { name: 'chat' } | { name: 'library' } | { name: 'history'; selected?: string };
export type Theme = 'system' | 'light' | 'dark';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface Settings { generalKnowledge: boolean; historyEnabled: boolean; theme: Theme }

export interface PdfTarget {
	key: string;
	title: string;
	subtitle?: string;
	page: number;
	citation?: Citation;
	load: () => Promise<ArrayBuffer>;
	/** Where focus returns when the viewer closes. */
	returnFocus?: HTMLElement | null;
}

export interface Publication {
	phase: 'checking' | 'ready' | 'publishing' | 'done' | 'failed' | 'cancelled';
	files: ReviewFile[];
	confirmSkip: boolean;
	step?: string;
	filesDone: number;
	pagesDone: number;
	startedAt?: number;
	error?: string;
	added?: number;
}

const defaultSettings: Settings = { generalKnowledge: true, historyEnabled: true, theme: 'system' };

function useStoreValue() {
	const toast = useToast();
	const [docs, setDocs] = useState<LibraryDoc[]>(sampleLibrary);
	const [conversations, setConversations] = useState<Conversation[]>(sampleConversations);
	const [currentId, setCurrentId] = useState<string | null>(null);
	const [temporaryMode, setTemporaryMode] = useState(false);
	const [settings, setSettings] = useState<Settings>(defaultSettings);
	const [saveState, setSaveState] = useState<Record<'generalKnowledge' | 'historyEnabled', SaveState>>({ generalKnowledge: 'idle', historyEnabled: 'idle' });
	const [scenario, setScenarioState] = useState<Scenario>(defaultScenario);
	const [busy, setBusy] = useState(false);
	const [view, setView] = useState<View>({ name: 'chat' });
	const [pdf, setPdf] = useState<PdfTarget | null>(null);
	const [publication, setPublication] = useState<Publication | null>(null);
	const [pendingDocs, setPendingDocs] = useState<Set<string>>(new Set());
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [composerSeed, setComposerSeed] = useState<{ text: string; n: number } | null>(null);

	const live = useRef({ docs, settings, scenario, conversations, currentId, temporaryMode, busy });
	live.current = { docs, settings, scenario, conversations, currentId, temporaryMode, busy };
	const publishAbort = useRef<AbortController | null>(null);

	const current = conversations.find(c => c.id === currentId) ?? null;

	/* ---------------------------------------------------------------- navigation */

	const navigate = useCallback((next: View) => { setView(next); setPdf(null); }, []);

	const newChat = useCallback((temporary = false) => {
		setCurrentId(null);
		setTemporaryMode(temporary);
		setView({ name: 'chat' });
		setPdf(null);
	}, []);

	const openConversation = useCallback((id: string) => {
		setCurrentId(id);
		setTemporaryMode(false);
		setView({ name: 'chat' });
		setPdf(null);
	}, []);

	/* ---------------------------------------------------------------- answering */

	const patchMessage = useCallback((convId: string, messageId: string, patch: Partial<Extract<Message, { role: 'assistant' }>>) => {
		setConversations(list => list.map(c => c.id !== convId ? c : {
			...c,
			messages: c.messages.map(m => m.id === messageId && m.role === 'assistant' ? { ...m, ...patch } : m),
		}));
	}, []);

	const run = useCallback(async (convId: string, messageId: string, question: string) => {
		setBusy(true);
		const { settings: s, docs: d, scenario: sc } = live.current;
		try {
			const reply = await hostAsk(question, {
				generalKnowledge: s.generalKnowledge,
				enabledDocs: new Set(d.filter(doc => doc.enabled).map(doc => doc.id)),
				scenario: sc,
				onPhase: (phase, passages) => patchMessage(convId, messageId, { phase, passages }),
			});
			const conv = live.current.conversations.find(c => c.id === convId);
			const temporary = conv?.temporary ?? false;
			const save: 'saved' | 'failed' | 'off' | 'temporary' = temporary ? 'temporary' : !live.current.settings.historyEnabled ? 'off' : live.current.scenario.historyFails ? 'failed' : 'saved';
			patchMessage(convId, messageId, { state: 'done', reply, phase: undefined, save });
			if (save === 'saved') setConversations(list => list.map(c => c.id === convId ? { ...c, saved: true, updatedAt: Date.now() } : c));
		} catch (cause) {
			patchMessage(convId, messageId, { state: 'failed', phase: undefined, error: cause instanceof Error ? cause.message : 'The answer could not be completed.' });
			setScenarioState(sc2 => ({ ...sc2, answerFails: false }));
		} finally {
			setBusy(false);
		}
	}, [patchMessage]);

	const ask = useCallback((text: string) => {
		const question = text.trim();
		if (!question || live.current.busy || live.current.scenario.model !== 'ready') return false;
		let convId = live.current.currentId;
		const user: Message = { id: uid('m'), role: 'user', text: question };
		const assistant: Message = { id: uid('m'), role: 'assistant', question, state: 'pending', phase: 'searching' };
		if (!convId || !live.current.conversations.some(c => c.id === convId)) {
			convId = uid('c');
			const conv: Conversation = { id: convId, title: titleFrom(question), updatedAt: Date.now(), temporary: live.current.temporaryMode, saved: false, messages: [user, assistant] };
			setConversations(list => [conv, ...list]);
			setCurrentId(convId);
			live.current.conversations = [conv, ...live.current.conversations];
		} else {
			setConversations(list => list.map(c => c.id === convId ? { ...c, messages: [...c.messages, user, assistant] } : c));
		}
		void run(convId, assistant.id, question);
		return true;
	}, [run]);

	const retry = useCallback((convId: string, messageId: string) => {
		if (live.current.busy) return;
		const conv = live.current.conversations.find(c => c.id === convId);
		const msg = conv?.messages.find(m => m.id === messageId);
		if (!msg || msg.role !== 'assistant') return;
		patchMessage(convId, messageId, { state: 'pending', phase: 'searching', error: undefined, reply: undefined, save: undefined });
		void run(convId, messageId, msg.question);
	}, [patchMessage, run]);

	const retrySave = useCallback(async (convId: string, messageId: string) => {
		await quickOp(live.current.scenario, 600);
		if (live.current.scenario.historyFails) { toast({ tone: 'error', text: 'Still couldn’t save to history. The answer stays here.' }); return; }
		patchMessage(convId, messageId, { save: 'saved' });
		setConversations(list => list.map(c => c.id === convId ? { ...c, saved: true, updatedAt: Date.now() } : c));
		toast({ tone: 'success', text: 'Saved to history' });
	}, [patchMessage, toast]);

	/* ---------------------------------------------------------------- history */

	const deleteConversation = useCallback(async (id: string) => {
		await quickOp(live.current.scenario, 500);
		if (live.current.scenario.settingsFail) throw new Error('The conversation couldn’t be deleted.');
		setConversations(list => list.filter(c => c.id !== id));
		if (live.current.currentId === id) setCurrentId(null);
		setView(v => v.name === 'history' && v.selected === id ? { name: 'history' } : v);
		toast({ tone: 'success', text: 'Conversation deleted' });
	}, [toast]);

	const clearHistory = useCallback(async () => {
		await quickOp(live.current.scenario, 700);
		if (live.current.scenario.settingsFail) throw new Error('History couldn’t be cleared.');
		setConversations(list => list.filter(c => !c.saved));
		setCurrentId(id => (id && live.current.conversations.find(c => c.id === id)?.saved ? null : id));
		toast({ tone: 'success', text: 'All saved conversations deleted' });
	}, [toast]);

	/* ---------------------------------------------------------------- settings */

	const updateSetting = useCallback(async (key: 'generalKnowledge' | 'historyEnabled', value: boolean) => {
		const previous = live.current.settings[key];
		setSettings(s => ({ ...s, [key]: value }));
		setSaveState(s => ({ ...s, [key]: 'saving' }));
		try {
			await saveSetting(live.current.scenario);
			setSaveState(s => ({ ...s, [key]: 'saved' }));
			window.setTimeout(() => setSaveState(s => (s[key] === 'saved' ? { ...s, [key]: 'idle' } : s)), 2400);
			return true;
		} catch {
			setSettings(s => ({ ...s, [key]: previous }));
			setSaveState(s => ({ ...s, [key]: 'error' }));
			return false;
		}
	}, []);

	const setTheme = useCallback((theme: Theme) => setSettings(s => ({ ...s, theme })), []);

	/* ---------------------------------------------------------------- library */

	const docBytes = useCallback(async (doc: LibraryDoc) => {
		if (doc.source.kind === 'memory') return doc.source.data;
		const res = await fetch(doc.source.url);
		if (!res.ok) throw new Error('The PDF could not be opened.');
		return res.arrayBuffer();
	}, []);

	const setDocEnabled = useCallback(async (id: string, enabled: boolean) => {
		setPendingDocs(s => new Set(s).add(id));
		setDocs(list => list.map(d => d.id === id ? { ...d, enabled } : d));
		await quickOp(live.current.scenario, 450);
		setPendingDocs(s => { const n = new Set(s); n.delete(id); return n; });
		if (live.current.scenario.settingsFail) {
			setDocs(list => list.map(d => d.id === id ? { ...d, enabled: !enabled } : d));
			toast({ tone: 'error', text: 'That change couldn’t be saved. Try again.' });
		}
	}, [toast]);

	const deleteDoc = useCallback(async (id: string) => {
		await quickOp(live.current.scenario, 900);
		if (live.current.scenario.settingsFail) throw new Error('The document couldn’t be deleted.');
		const doc = live.current.docs.find(d => d.id === id);
		setDocs(list => list.filter(d => d.id !== id));
		toast({ tone: 'success', text: `Deleted “${doc?.title ?? 'document'}”` });
	}, [toast]);

	const startReview = useCallback(async (files: { name: string; size: number; data: ArrayBuffer }[]) => {
		if (publication?.phase === 'publishing') return;
		const existing = new Set(live.current.docs.map(d => d.filename.toLowerCase()));
		const entries: ReviewFile[] = files.map(f => ({ id: uid('f'), name: f.name, size: f.size, status: 'checking', data: f.data }));
		setPublication({ phase: 'checking', files: entries, confirmSkip: false, filesDone: 0, pagesDone: 0 });
		const results = await Promise.all(files.map(async (f, i) => {
			const [result] = await Promise.all([reviewFile(f, existing), wait((live.current.scenario.fast ? 150 : 600) + i * 180)]);
			setPublication(p => p && { ...p, files: p.files.map(x => x.id === entries[i].id ? { ...x, ...result } : x) });
			return result;
		}));
		void results;
		setPublication(p => p && p.phase === 'checking' ? { ...p, phase: 'ready' } : p);
	}, [publication?.phase]);

	const setConfirmSkip = useCallback((value: boolean) => setPublication(p => p && { ...p, confirmSkip: value }), []);
	const dismissReview = useCallback(() => { publishAbort.current?.abort(); setPublication(null); }, []);

	const publish = useCallback(async () => {
		const p = publication;
		if (!p) return;
		const accepted = p.files.filter(f => f.status === 'accepted');
		if (!accepted.length) return;
		const controller = new AbortController();
		publishAbort.current = controller;
		const k = live.current.scenario.fast ? 0.25 : 1;
		setPublication({ ...p, phase: 'publishing', step: 'Getting ready', filesDone: 0, pagesDone: 0, startedAt: Date.now(), error: undefined });
		try {
			let pages = 0;
			for (const [i, f] of accepted.entries()) {
				for (const step of ['Reading text', 'Splitting into passages', 'Indexing']) {
					setPublication(x => x && { ...x, step: `${step} · ${f.title ?? f.name}` });
					await wait(700 * k, controller.signal);
				}
				pages += f.pages ?? 0;
				setPublication(x => x && { ...x, filesDone: i + 1, pagesDone: pages });
			}
			setPublication(x => x && { ...x, step: 'Checking the updated library' });
			await wait(900 * k, controller.signal);
			if (live.current.scenario.publishFails) throw new Error('The updated library didn’t pass its final check.');
			const added: LibraryDoc[] = accepted.map(f => ({
				id: uid('doc'),
				title: f.title ?? f.name,
				filename: f.name,
				pages: f.pages ?? 1,
				size: f.size,
				addedAt: Date.now(),
				enabled: true,
				source: { kind: 'memory', data: f.data as ArrayBuffer },
				isNew: true,
			}));
			const replaced = new Set(added.map(d => d.filename.toLowerCase()));
			setDocs(list => [...added, ...list.filter(d => !replaced.has(d.filename.toLowerCase()))]);
			setPublication(x => x && { ...x, phase: 'done', added: added.length });
			toast({ tone: 'success', text: `${added.length} ${added.length === 1 ? 'document' : 'documents'} added to your library` });
		} catch (cause) {
			if ((cause as Error).name === 'AbortError') setPublication(x => x && { ...x, phase: 'cancelled' });
			else setPublication(x => x && { ...x, phase: 'failed', error: (cause as Error).message });
		} finally {
			publishAbort.current = null;
		}
	}, [publication, toast]);

	const cancelPublication = useCallback(() => publishAbort.current?.abort(), []);

	/* ---------------------------------------------------------------- prototype controls */

	const setScenario = useCallback((patch: Partial<Scenario>) => setScenarioState(s => ({ ...s, ...patch })), []);

	useEffect(() => {
		if (scenario.model !== 'starting') return;
		const timer = window.setTimeout(() => setScenarioState(s => (s.model === 'starting' ? { ...s, model: 'ready' } : s)), scenario.fast ? 2500 : 7000);
		return () => window.clearTimeout(timer);
	}, [scenario.model, scenario.fast]);

	const resetPrototype = useCallback(() => {
		setDocs(sampleLibrary()); setConversations(sampleConversations()); setCurrentId(null); setTemporaryMode(false);
		setSettings(defaultSettings); setScenarioState(defaultScenario); setPublication(null); setPdf(null); setView({ name: 'chat' });
		toast({ tone: 'info', text: 'Prototype reset to its sample data' });
	}, [toast]);

	const emptyLibrary = useCallback(() => { setDocs([]); setView({ name: 'library' }); }, []);

	const seedComposer = useCallback((text: string) => setComposerSeed(s => ({ text, n: (s?.n ?? 0) + 1 })), []);

	return useMemo(() => ({
		docs, conversations, current, currentId, temporaryMode, settings, saveState, scenario, busy, view, pdf, publication, pendingDocs, settingsOpen, composerSeed,
		navigate, newChat, openConversation, ask, retry, retrySave, deleteConversation, clearHistory, updateSetting, setTheme,
		docBytes, setDocEnabled, deleteDoc, startReview, setConfirmSkip, dismissReview, publish, cancelPublication,
		openPdf: (t: PdfTarget) => setPdf({ ...t, returnFocus: t.returnFocus ?? (document.activeElement as HTMLElement | null) }), closePdf: () => setPdf(null), setSettingsOpen, setTemporaryMode, setScenario, resetPrototype, emptyLibrary, seedComposer,
	}), [docs, conversations, current, currentId, temporaryMode, settings, saveState, scenario, busy, view, pdf, publication, pendingDocs, settingsOpen, composerSeed,
		navigate, newChat, openConversation, ask, retry, retrySave, deleteConversation, clearHistory, updateSetting, setTheme,
		docBytes, setDocEnabled, deleteDoc, startReview, setConfirmSkip, dismissReview, publish, cancelPublication, setScenario, resetPrototype, emptyLibrary, seedComposer]);
}

export type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
	const value = useStoreValue();
	return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
	const store = useContext(StoreContext);
	if (!store) throw new Error('useStore outside StoreProvider');
	return store;
}
