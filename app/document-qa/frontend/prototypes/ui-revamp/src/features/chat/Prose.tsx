/*
 * Minimal answer formatter: paragraphs, bullet lists, **bold**, *italic* and
 * [n] citation markers. Everything renders as React text nodes, never HTML.
 * (Production keeps its own sanitizing Markdown renderer.)
 */
import type { ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[\d+\])/g;

export function Prose({ text, renderCitation }: { text: string; renderCitation: (index: number, key: string) => ReactNode }) {
	const inline = (line: string, prefix: string) =>
		line.split(INLINE).filter(Boolean).map((part, i) => {
			const key = `${prefix}-${i}`;
			if (part.startsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
			if (part.startsWith('*') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
			const cite = /^\[(\d+)\]$/.exec(part);
			if (cite) return renderCitation(Number(cite[1]) - 1, key);
			return part;
		});
	return (
		<div className="prose">
			{text.split(/\n{2,}/).map((block, b) => {
				const lines = block.split('\n');
				if (lines.every(l => l.startsWith('- '))) {
					return <ul key={b}>{lines.map((l, i) => <li key={i}>{inline(l.slice(2), `${b}-${i}`)}</li>)}</ul>;
				}
				return <p key={b}>{inline(block, String(b))}</p>;
			})}
		</div>
	);
}

export function plainText(text: string, citations: { document_title: string; page_start: number; page_end: number }[]): string {
	const body = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
	if (!citations.length) return body;
	const sources = citations.map((c, i) => `[${i + 1}] ${c.document_title}, ${c.page_end > c.page_start ? `pages ${c.page_start}–${c.page_end}` : `page ${c.page_start}`}`);
	return `${body}\n\nSources\n${sources.join('\n')}`;
}
