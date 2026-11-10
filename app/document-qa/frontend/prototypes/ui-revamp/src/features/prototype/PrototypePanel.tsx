/* Review-only controls. Not part of the proposed product interface. */
import { useId, useState } from 'react';
import { SUGGESTIONS } from '../../data/samples';
import { useStore } from '../../store';
import { IconFlask } from '../../ui/icons';
import { Popover } from '../../ui/overlay';
import { Button, Segmented, Switch } from '../../ui/primitives';

export function PrototypePanel() {
	const store = useStore();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);
	const title = useId();
	const s = store.scenario;
	const row = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
		return (
			<label className="proto-row">
				<span>{label}</span>
				<Switch checked={checked} label={label} onChange={onChange} />
			</label>
		);
	};
	return (
		<>
			<button ref={setAnchor} type="button" className="proto-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
				<IconFlask size={15} /><span className="proto-btn-label">Prototype</span>
			</button>
			<Popover anchor={anchor} open={open} onClose={() => setOpen(false)} labelledBy={title} align="end" className="proto-panel">
				<h2 id={title} className="popover-title">Prototype controls</h2>
				<p className="popover-text">Fictional sample data. These switches simulate host behavior so every state can be reviewed.</p>

				<p className="proto-label">Local model</p>
				<Segmented label="Local model state" value={s.model} onChange={model => store.setScenario({ model })}
					options={[{ value: 'ready', label: 'Ready' }, { value: 'starting', label: 'Starting' }, { value: 'unavailable', label: 'Down' }]} />

				<p className="proto-label">Make the next action fail</p>
				{row('Next answer fails', s.answerFails, v => store.setScenario({ answerFails: v }))}
				{row('Saving to history fails', s.historyFails, v => store.setScenario({ historyFails: v }))}
				{row('Settings, toggles and deletes fail', s.settingsFail, v => store.setScenario({ settingsFail: v }))}
				{row('Adding PDFs fails at the last step', s.publishFails, v => store.setScenario({ publishFails: v }))}

				<p className="proto-label">Other</p>
				{row('Fast mode (shorter delays)', s.fast, v => store.setScenario({ fast: v }))}

				<p className="proto-label">Try these questions</p>
				<ul className="proto-questions">
					{SUGGESTIONS.map(q => (
						<li key={q.question}><button type="button" className="link-btn" onClick={() => { setOpen(false); store.newChat(); store.seedComposer(q.question); }}>{q.hint}</button></li>
					))}
					<li><button type="button" className="link-btn" onClick={() => { setOpen(false); store.newChat(); store.seedComposer('How often are evacuation drills held?'); }}>Uses a switched-off document</button></li>
				</ul>

				<div className="proto-foot">
					<Button size="sm" variant="ghost" onClick={() => { setOpen(false); store.emptyLibrary(); }}>Empty the library</Button>
					<Button size="sm" variant="secondary" onClick={() => { setOpen(false); store.resetPrototype(); }}>Reset everything</Button>
				</div>
			</Popover>
		</>
	);
}
