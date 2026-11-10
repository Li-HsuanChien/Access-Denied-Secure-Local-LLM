import { useId, useState, type MouseEvent } from 'react';
import { useHealth, useNavigation, usePreferences } from '../../../../react/providers';
import { isChatPath } from '../../../../react/routes/navigation';
import { useI18n } from '@/react/i18n';
import { Button, IconButton, IconCompose, IconLock, IconMenu, IconSidebar, IconTemporary, Popover, Switch, Tooltip, modifierLabel } from '../../design-system/react';

export interface TopBarProps {
	sidebarOpen: boolean;
	compact: boolean;
	/** Title of the open saved thread, if any. */
	title?: string;
	onToggleSidebar(): void;
	onNavigate(): void;
}

export function TopBar({ sidebarOpen, compact, title, onToggleSidebar, onNavigate }: TopBarProps) {
	const { t } = useI18n();
	const { route, navigate } = useNavigation();
	const mod = modifierLabel();
	const onChatRoot = route.path === '/' || route.path === '/qa';
	const temporary = onChatRoot && route.temporary;
	const toggleTemporary = (event: MouseEvent) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		navigate('/', { newChat: true, temporary: !route.temporary });
		onNavigate();
	};
	const temporaryLabel = temporary ? 'Start saved chat' : 'Start temporary chat';

	return (
		<header className="shell-topbar">
			<div className="shell-topbar-start">
				{!sidebarOpen && (
					<>
						<IconButton
							label={compact ? 'Open menu' : t('Open Sidebar')}
							shortcut={compact ? undefined : `${mod}B`}
							icon={compact ? <IconMenu /> : <IconSidebar />}
							onClick={onToggleSidebar}
							aria-expanded={false}
							aria-controls="sidebar"
							data-shell-menu-button=""
						/>
						<IconButton label={t('New Chat')} icon={<IconCompose />} onClick={() => { navigate('/', { newChat: true }); onNavigate(); }} />
					</>
				)}
				{isChatPath(route.path) && title && <h1 className="shell-topbar-title" title={title}>{title}</h1>}
				{temporary && <span className="shell-temp-badge"><IconTemporary size={15} /> Temporary</span>}
			</div>
			<div className="shell-topbar-end">
				<StatusButton />
				{onChatRoot && (
					<Tooltip content={temporaryLabel}>
						<a
							href={temporary ? '/' : '/?local-temporary=true'}
							className={`ui-icon-btn ui-icon-btn-md${temporary ? ' is-on' : ''}`}
							aria-label={temporaryLabel}
							onClick={toggleTemporary}
						>
							<IconTemporary />
						</a>
					</Tooltip>
				)}
			</div>
		</header>
	);
}

const pillLabel = { checking: 'Checking…', ready: 'Ready', 'needs-documents': 'Add documents', unavailable: 'Unavailable' } as const;
const popoverTitle = {
	checking: 'Checking the local model',
	ready: 'Ready to answer',
	'needs-documents': 'Ready once you add documents',
	unavailable: 'The local model isn’t running'
} as const;

/** Readiness pill + popover from the existing `/health` read, with the general-knowledge preference. */
function StatusButton() {
	const health = useHealth();
	const { state: preferences, setGeneralKnowledge } = usePreferences();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	const [preferenceError, setPreferenceError] = useState('');
	const titleId = useId();
	const gkId = useId();
	const { readiness } = health;
	const library = health.health?.library;
	const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
	return (
		<>
			<button ref={setAnchor} type="button" className="shell-status-pill" data-state={readiness} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
				<span className="shell-status-dot" aria-hidden="true" />
				<span><span className="ui-sr-only">Assistant status: </span>{pillLabel[readiness]}</span>
			</button>
			<span className="ui-sr-only" role="status" aria-live="polite">{readiness === 'checking' ? '' : `Assistant status: ${pillLabel[readiness]}`}</span>
			<Popover anchor={anchor} open={open} onClose={() => setOpen(false)} labelledBy={titleId} align="end" className="shell-status-popover">
				<h2 id={titleId} className="ui-popover-title">{popoverTitle[readiness]}</h2>
				{health.message && <p className="ui-popover-text">{health.message}</p>}
				<dl className="ui-status-list">
					<div><dt>Documents</dt><dd>{library ? `${count(library.document_count, 'document')} · ${count(library.chunk_count, 'passage')}` : '—'}</dd></div>
					<div><dt>Local model</dt><dd>{readiness === 'checking' ? 'Checking…' : health.health?.answering.ready ? 'Ready' : 'Not ready'}</dd></div>
				</dl>
				<div className="shell-status-setting">
					<span id={gkId}>Include general model knowledge</span>
					<Switch
						labelledBy={gkId}
						checked={preferences.generalKnowledge}
						pending={preferences.pending.generalKnowledge > 0}
						onChange={async next => {
							setPreferenceError('');
							try { await setGeneralKnowledge(next); } catch { setPreferenceError('Could not save this preference. Please retry.'); }
						}}
					/>
				</div>
				<p className="shell-status-hint">Used only when your documents can’t answer.</p>
				{preferenceError && <p className="ui-form-error" role="alert">{preferenceError}</p>}
				<p className="ui-popover-foot"><IconLock size={14} /> Everything runs on this computer. Nothing is sent over a network.</p>
				<Button size="sm" variant={readiness === 'unavailable' ? 'primary' : 'secondary'} pending={health.refreshing} onClick={() => void health.refresh()}>Check again</Button>
			</Popover>
		</>
	);
}
