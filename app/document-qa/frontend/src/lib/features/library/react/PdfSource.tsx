import { useEffect, useState } from 'react';
import { useServices } from '../../../../react/providers';
import type { Citation, Immutable } from '../../react-contracts';
import { PdfPreview } from './PdfPreview';

export function PdfSource({ documentId, version, citation }: { documentId: string; version?: string | null; citation?: Immutable<Citation> }) {
 const { answering } = useServices();
 const [data, setData] = useState<ArrayBuffer | null>(null);
 const [error, setError] = useState('');
 useEffect(() => {
  let active = true;
  setData(null); setError('');
  void answering.fetchSource(documentId, version).then(bytes => { if (active) setData(bytes); })
   .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'The source document could not be opened.'); });
  return () => { active = false; };
 }, [answering, documentId, version]);
 if (error) return <p role="alert">{error} Close the preview and select the document to try again.</p>;
 return data ? <PdfPreview data={data} citation={citation} /> : <p role="status">Loading PDF preview…</p>;
}
