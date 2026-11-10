import { useId, useState } from 'react';
import { MODEL } from '../../data/samples';
import { useStore } from '../../store';
import { IconCompose, IconLock, IconSidebar, IconTemporary } from '../../ui/icons';
import { Popover } from '../../ui/overlay';
import { Button, IconButton } from '../../ui/primitives';
import { PrototypePanel } from '../prototype/PrototypePanel';

export function TopBar({ sidebarOpen, compact, onToggleSidebar }: { sidebarOpen: boolean; compact: boolean; onToggleSidebar: () => void }) {
	const store = useStore();
	const { view, current, temporaryMode } = store;
	const inChat = view.name === 'chat';
	const temporary = current ? current.temporary : temporaryMode;
	const canToggleTemporary = inChat && (!current || current.temporary);
	const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

	return (
		<header className="topbar">
			<div className="topbar-start">
				{!sidebarOpen && (
					<>
						<IconButton label={compact ? 'Open menu' : 'Show sidebar'} shortcut={compact ? undefined : `${mod}B`} icon={<IconSidebar />} onClick={onToggleSidebar} aria-expanded={false} />
						<IconButton label="New chat" icon={<IconCompose />} onClick={() => store.newChat()} />
					</>
				)}
				{inChat && current && (
					<h1 className="topbar-title" title={current.title}>{current.title}</h1>
				)}
				{inChat && temporary && <span className="temp-badge"><IconTemporary size={15} /> Temporary</span>}
			</div>
			<div className="topbar-end">
				<PrototypePanel />
				<StatusButton />
				{canToggleTemporary && (
					<IconButton
						label={temporary ? 'Turn off temporary chat' : 'Start a temporary chat'}
						icon={<IconTemporary />}
						aria-pressed={temporary}
						className={temporary ? 'is-on' : ''}
						onClick={() => store.newChat(!temporary)}
					/>
				)}
			</div>
		</header>
	);
}

function StatusButton() {
	const store = useStore();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	const titleId = useId();
	const { model } = store.scenario;
	const enabled = store.docs.filter(d => d.enabled);
	const label = model === 'ready' ? 'Ready' : model === 'starting' ? 'Starting…' : 'Unavailable';
	return (
		<>
			<button ref={setAnchor} type="button" className="status-pill" data-state={model} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
				<span className="status-dot" aria-hidden="true" />
				<span><span className="sr-only">Assistant status: </span>{label}</span>
			</button>
			<Popover anchor={anchor} open={open} onClose={() => setOpen(false)} labelledBy={titleId} align="end" className="status-popover">
				<h2 id={titleId} className="popover-title">
					{model === 'ready' ? 'Ready to answer' : model === 'starting' ? 'Starting the local model' : 'The local model isn’t running'}
				</h2>
				{model === 'starting' && <p className="popover-text">This usually takes less than a minute. You can browse your library and past chats meanwhile.</p>}
				{model === 'unavailable' && <p className="popover-text">Answers are paused, but your library and history still work. Try starting it again; if that fails, restart the app.</p>}
				<dl className="status-list">
					<div><dt>Model</dt><dd>{MODEL.name} · {MODEL.quant}</dd></div>
					<div><dt>Documents</dt><dd>{enabled.length} of {store.docs.length} used for answers</dd></div>
					<div><dt>General knowledge</dt><dd>{store.settings.generalKnowledge ? 'On, used only when documents can’t answer' : 'Off'}</dd></div>
				</dl>
				<p className="popover-foot"><IconLock size={14} /> Everything runs on this computer. Nothing is sent over a network.</p>
				{model === 'unavailable' && (
					<Button variant="primary" size="sm" onClick={() => store.setScenario({ model: 'starting' })}>Start again</Button>
				)}
			</Popover>
		</>
	);
}
