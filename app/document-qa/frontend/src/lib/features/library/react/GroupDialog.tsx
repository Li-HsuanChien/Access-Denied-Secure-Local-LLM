/*
 * Create or edit a document group: a name plus a checklist of PDFs in the library.
 * The Library coordinator saves it; this component only collects the choice.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../design-system/react';

export interface GroupDialogDocument { readonly id: string; readonly title: string }
export interface GroupDialogValue { readonly groupId: string | null; readonly name: string; readonly documentIds: readonly string[] }

export const GROUP_NAME_MAX = 80;

export function GroupDialog({ open, initial, documents, busy, onCancel, onSave }: {
	open: boolean;
	initial: GroupDialogValue | null;
	documents: readonly GroupDialogDocument[];
	busy: boolean;
	onCancel: () => void;
	onSave: (value: GroupDialogValue) => Promise<void>;
}) {
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState('');
	const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		setName(initial?.name ?? '');
		setChosen(new Set(initial?.documentIds ?? []));
		setSaving(false);
	}, [open, initial]);

	const trimmed = name.trim();
	const ids = documents.filter(doc => chosen.has(doc.id)).map(doc => doc.id);
	const canSave = !busy && !saving && trimmed.length > 0 && ids.length > 0;

	function flip(id: string, on: boolean) {
		setChosen(current => {
			const next = new Set(current);
			if (on) next.add(id); else next.delete(id);
			return next;
		});
	}

	async function save() {
		if (!canSave) return;
		setSaving(true);
		try { await onSave({ groupId: initial?.groupId ?? null, name: trimmed, documentIds: ids }); }
		finally { setSaving(false); }
	}

	return (
		<Dialog
			open={open}
			onClose={saving ? () => undefined : onCancel}
			title={initial?.groupId ? 'Edit group' : 'New group'}
			description="Switch these PDFs on or off together. A group is on only when all of its PDFs are on."
			initialFocus={nameRef}
			className="lib-group-dialog"
			footer={
				<>
					<Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
					<Button variant="primary" onClick={() => void save()} disabled={!canSave} pending={saving}>Save group</Button>
				</>
			}
		>
			<form className="lib-group-form" onSubmit={event => { event.preventDefault(); void save(); }}>
				<label className="lib-group-name">
					<span>Group name</span>
					<input ref={nameRef} type="text" value={name} maxLength={GROUP_NAME_MAX} onChange={event => setName(event.currentTarget.value)} />
				</label>
				<fieldset className="lib-group-members">
					<legend>PDFs in this group <span className="lib-group-count">{ids.length} selected</span></legend>
					{documents.map(doc => (
						<label key={doc.id} className="ui-check">
							<input type="checkbox" checked={chosen.has(doc.id)} onChange={event => flip(doc.id, event.currentTarget.checked)} />
							<span>{doc.title}</span>
						</label>
					))}
				</fieldset>
			</form>
		</Dialog>
	);
}
