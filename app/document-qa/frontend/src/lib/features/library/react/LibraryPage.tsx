import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLibrary, useNavigation } from '../../../../react/providers';
import type { SelectedPdf } from '../../react-contracts';
import './LibraryPage.css';

function message(error: unknown) {
	return error instanceof Error ? error.message : 'The local library request failed.';
}

function encode(file: File): Promise<SelectedPdf> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error);
		reader.onload = () => resolve({ name: file.name, size: file.size, data: String(reader.result).split(',')[1] ?? '' });
		reader.readAsDataURL(file);
	});
}

export function LibraryPage() {
	const library = useLibrary();
	const { route } = useNavigation();
	const picker = useRef<HTMLInputElement>(null);
	const generation = useRef(0);
	const mounted = useRef(false);
	const pendingRead = useRef<Promise<SelectedPdf[]> | null>(null);
	const deferredSelection = useRef<{ generation: number; files: SelectedPdf[] } | null>(null);
	const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
	const [fileError, setFileError] = useState('');
	const previousNotice = useRef(library.state.notice);
	const libraryState = useRef(library.state);
	libraryState.current = library.state;
	const selected = library.state.selected;
	const selectedCount = pendingFiles?.length ?? selected.length;
	const selectedNames = pendingFiles?.map((file) => file.name).join(', ') ?? selected.map((file) => file.name).join(', ');

	useEffect(() => {
		mounted.current = true;
		document.title = 'Library · Access Denied';
		void library.refresh();
		return () => {
			mounted.current = false;
			generation.current += 1;
			const currentGeneration = generation.current;
			queueMicrotask(() => {
				if (!mounted.current && generation.current === currentGeneration) library.leave();
			});
		};
	}, [library.refresh, library.leave]);

	useEffect(() => {
		const notice = library.state.notice;
		if (notice !== previousNotice.current && notice.startsWith('Collection ') && notice.includes(' is active ·')) {
			generation.current += 1;
			pendingRead.current = null;
			deferredSelection.current = null;
			if (picker.current) picker.current.value = '';
			setPendingFiles(null);
		}
		previousNotice.current = notice;
		if (!library.state.busy && deferredSelection.current) {
			const deferred = deferredSelection.current;
			deferredSelection.current = null;
			if (deferred.generation === generation.current) {
				library.select(deferred.files);
				setPendingFiles(null);
			}
		}
	}, [library.state.busy, library.state.notice, library.select]);

	useEffect(() => {
		if (route.path !== '/library') library.leave();
	}, [route.path, library.leave]);

	function selectFiles(event: ChangeEvent<HTMLInputElement>) {
		const files = Array.from(event.currentTarget.files ?? []);
		const selection = ++generation.current;
		setPendingFiles(files);
		setFileError('');
		library.select([]);
		pendingRead.current = Promise.all(files.map(encode));
		void pendingRead.current.then((encoded) => {
			if (mounted.current && generation.current === selection) {
				if (libraryState.current.busy) deferredSelection.current = { generation: selection, files: encoded };
				else {
					library.select(encoded);
					setPendingFiles(null);
				}
			}
		}).catch((error: unknown) => {
			if (mounted.current && generation.current === selection) {
				setFileError(message(error));
				setPendingFiles(null);
			}
		});
	}

	async function inspect() {
		const selection = generation.current;
		try {
			if (pendingRead.current) {
				const files = await pendingRead.current;
				if (!mounted.current || generation.current !== selection) return;
				library.select(files);
				setPendingFiles(null);
			}
			await library.review();
		} catch (error) {
			if (mounted.current && generation.current === selection) {
				setFileError(message(error));
				setPendingFiles(null);
			}
		}
	}

	return (
		<div className="workspace-page library-page" aria-labelledby="title">
			<p className="eyebrow">Local document collection</p>
			<h1 id="title">Library</h1>
			<p className="lede">Select PDFs, review every rejection, then confirm publication of the accepted remainder.</p>

			<section className="panel" aria-labelledby="select-title">
				<h2 id="select-title">Add PDFs</h2>
				<label className={`picker${selectedCount ? ' has-files' : ''}`} htmlFor="pdfs">
					<input ref={picker} id="pdfs" type="file" accept="application/pdf,.pdf" multiple onChange={selectFiles} />
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" /></svg>
					<span className="picker-title">{selectedCount ? `${selectedCount} file${selectedCount === 1 ? '' : 's'} selected` : 'Choose PDF files'}</span>
					<span className="hint">{selectedCount ? selectedNames : 'Files stay on this computer. Nothing is published until you confirm.'}</span>
				</label>
				{selectedCount > 0 && <div className="actions"><button className="btn primary" type="button" onClick={() => void inspect()} disabled={library.state.busy}>{library.state.busy ? 'Reviewing…' : 'Review selected files'}</button></div>}
			</section>

			{library.state.review && <section className="panel" aria-labelledby="review-title">
				<h2 id="review-title">Review import</h2>
				<h3>Accepted ({library.state.review.accepted.length})</h3>
				{library.state.review.accepted.length ? <ul className="rows">{library.state.review.accepted.map((file) => <li key={file.name}><span className="grow"><span className="name">{file.name}</span></span><span className="meta">{(file.size / 1048576).toFixed(1)} MiB</span></li>)}</ul> : <p className="empty">No PDFs passed validation.</p>}
				{library.state.review.rejected.length > 0 && <>
					<h3>Rejected ({library.state.review.rejected.length})</h3>
					<p className="message warning" role="alert">{library.state.review.warning} Review each reason before continuing.</p>
					<ul className="rows">{library.state.review.rejected.map((file, index) => <li key={`${file.name}-${index}`}><span className="grow"><span className="name">{file.name}</span><span className="meta rejected">{file.reason}</span></span></li>)}</ul>
					<label className="check"><input type="checkbox" checked={library.state.confirmed} onChange={(event) => library.confirm(event.currentTarget.checked)} /><span>I reviewed the rejected files and confirm publishing only the accepted PDFs.</span></label>
				</>}
				<div className="actions"><button className="btn primary" type="button" onClick={() => void library.publish()} disabled={library.state.busy || !library.state.review.accepted.length || (library.state.review.rejected.length > 0 && !library.state.confirmed)}>{library.state.attempted ? 'Restart publication' : 'Publish accepted PDFs'}</button></div>
			</section>}

			{library.state.busy && <section className="panel" role="status" aria-live="polite">
				<div className="heading"><h2>Publication in progress</h2><button className="btn" type="button" onClick={() => void library.cancel()} disabled={!library.state.publication}>Cancel publication</button></div>
				<p className="hint">{library.state.publication?.progress ?? ''} · {library.state.publication?.elapsedSeconds ?? 0}s elapsed</p>
			</section>}
			{library.state.notice && <p className="message notice" role="status">{library.state.notice}</p>}
			{(library.state.error || fileError) && <p className="message error" role="alert">{fileError || library.state.error}</p>}

			<section className="panel" aria-labelledby="versions-title">
				<div className="heading"><h2 id="versions-title">Collection versions</h2><button className="btn quiet" type="button" onClick={() => void library.refresh()}>Refresh</button></div>
				{library.state.versions.length ? <>
					<ul className="rows">{library.state.versions.map((version) => <li key={version.version_id}><span className="grow"><span className="name">{version.version_id}</span><span className="meta">{`${version.document_count} PDFs · ${version.chunk_count} passages`}</span></span><span className={`badge${version.status === 'active' ? ' active' : ''}`}>{version.status}</span></li>)}</ul>
					{library.state.versions.length > 1 && <div className="actions"><button className="btn" type="button" onClick={() => void library.rollback()} disabled={library.state.busy}>Roll back to previous version</button></div>}
				</> : <p className="empty">No collection has been published.</p>}
			</section>
		</div>
	);
}
