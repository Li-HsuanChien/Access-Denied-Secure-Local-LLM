"""
Render the complete character stream of a document with its chunk boundaries
drawn on it.

The point of the page is to make three things visible that a JSON dump does not:
a chunk is a character range over one continuous stream, consecutive chunks
overlap, and chunk boundaries do not respect page boundaries.

Usage:
  python3 tools/build_chunk_viewer.py                      # NRC baseline
  python3 tools/build_chunk_viewer.py --doc arxiv
  python3 tools/build_chunk_viewer.py --target-chars 800 --overlap-chars 150
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.ingest import chunks, extract, validate
from src.schema import ChunkerConfig, citation_targets

DOCS = {
    'normal': ('fixtures/normal/normal_nrc_reactor_concepts_ch01.pdf',
               'NRC Reactor Concepts Manual, Chapter 1'),
    'large': ('fixtures/large/large_doe_nuclear_physics_v1.pdf',
              'DOE Fundamentals Handbook, Nuclear Physics and Reactor Theory'),
    'arxiv': ('fixtures/layout/layout_arxiv_two_column_2112.11583.pdf',
              'arXiv 2112.11583, two-column layout'),
}


def build_segments(text, cs, pages):
    """
    Cut the stream at every chunk start, chunk end and page start, so each
    resulting segment has one constant set of owning chunks and one page.
    """
    cuts = {0, len(text)}
    for c in cs:
        cuts.add(c.char_start)
        cuts.add(c.char_end)
    for p in pages:
        cuts.add(p.char_start)
    cuts = sorted(x for x in cuts if 0 <= x <= len(text))

    page_at = {}
    for p in pages:
        page_at[p.char_start] = p.number

    segments = []
    current_page = 1
    for a, b in zip(cuts, cuts[1:]):
        if a in page_at:
            current_page = page_at[a]
        owners = [c.ordinal for c in cs if c.char_start <= a and c.char_end >= b]
        segments.append({
            'a': a, 'b': b,
            'owners': owners,
            'page': current_page,
            'page_start': a in page_at,
        })
    return segments


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--doc', default='normal', choices=sorted(DOCS))
    ap.add_argument('--target-chars', type=int, default=1200)
    ap.add_argument('--overlap-chars', type=int, default=200)
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    rel, label = DOCS[args.doc]
    pdf = ROOT / rel
    config = ChunkerConfig(target_chars=args.target_chars, overlap_chars=args.overlap_chars)

    result = validate(pdf)
    text, pages, handle = extract(pdf)
    handle.close()
    cs = chunks(pdf, config)
    segments = build_segments(text, cs, pages)

    payload = {
        'document': result.document,
        'label': label,
        'source': rel,
        'config': config.to_dict(),
        'text': text,
        'pages': [{'n': p.number, 'a': p.char_start, 'b': p.char_end,
                   'chars': p.char_end - p.char_start, 'spans': len(p.spans)}
                  for p in pages],
        'chunks': [{
            'ordinal': c.ordinal,
            'chunk_id': c.chunk_id,
            'a': c.char_start, 'b': c.char_end,
            'len': len(c.text),
            'page_start': c.page_start, 'page_end': c.page_end,
            'spans_pages': c.spans_pages,
            'tokens': c.token_estimate,
            'checksum': c.text_checksum_sha256,
            'page_spans': [{
                'page': s.page_number, 'a': s.char_start, 'b': s.char_end,
                'pa': s.page_char_start, 'pb': s.page_char_end,
                'rects': len(s.highlight_rects),
                'first_rect': s.highlight_rects[0] if s.highlight_rects else None,
                'reliable': s.coordinates_reliable,
                'w': round(s.page_width, 1), 'h': round(s.page_height, 1),
            } for s in c.page_spans],
            'citations': len(citation_targets(c)),
        } for c in cs],
        'segments': segments,
    }

    html = TEMPLATE.replace('__PAYLOAD__', json.dumps(payload, ensure_ascii=False))
    out = Path(args.out) if args.out else ROOT / 'walkthrough' / 'chunk_viewer.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')

    spanning = sum(1 for c in cs if c.spans_pages)
    print(f'{pdf.name}')
    print(f'   {len(text):,} chars, {len(pages)} pages, {len(cs)} chunks, '
          f'{spanning} spanning ({spanning / len(cs):.0%})')
    print(f'   {len(segments)} render segments')
    print(f'   -> {out.relative_to(ROOT)}  ({out.stat().st_size:,} bytes)')


TEMPLATE = r'''<title>Chunk Boundary Inspector</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root{
    --ground:#f4f6f9; --surface:#ffffff; --surface-2:#eef1f6;
    --ink:#161a21; --ink-2:#414b5a; --ink-3:#6f7b8d;
    --line:#d8dee8; --line-2:#c3ccda;
    --accent:#2f5d8a; --accent-ink:#ffffff;
    --warn:#9a5b12; --good:#1f6b4a;
    --sel:#1d4ed8;
    --c0:205; --c1:150; --c2:32; --c3:284; --c4:340; --c5:96; --c6:248; --c7:12;
    --tint-s:58%; --tint-l:90%;
    --rail:#e7ecf3;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#0f1319; --surface:#161b23; --surface-2:#1d242e;
      --ink:#e6ebf3; --ink-2:#b3bdcc; --ink-3:#7d8899;
      --line:#2a323e; --line-2:#3a4453;
      --accent:#7db2e8; --accent-ink:#0f1319;
      --warn:#e0a45c; --good:#5fc39a;
      --sel:#8ab4f8;
      --tint-s:42%; --tint-l:24%;
      --rail:#1a212a;
    }
  }
  :root[data-theme="dark"]{
    --ground:#0f1319; --surface:#161b23; --surface-2:#1d242e;
    --ink:#e6ebf3; --ink-2:#b3bdcc; --ink-3:#7d8899;
    --line:#2a323e; --line-2:#3a4453;
    --accent:#7db2e8; --accent-ink:#0f1319;
    --warn:#e0a45c; --good:#5fc39a;
    --sel:#8ab4f8;
    --tint-s:42%; --tint-l:24%;
    --rail:#1a212a;
  }

  body{
    background:var(--ground); color:var(--ink);
    font-family:"IBM Plex Sans",system-ui,-apple-system,sans-serif;
    line-height:1.5; margin:0;
  }
  .wrap{ max-width:1400px; margin:0 auto; padding:0 16px; padding-block:24px 48px; }

  header.masthead{ border-bottom:1px solid var(--line); padding-bottom:18px; margin-bottom:20px; }
  .eyebrow{
    font-size:11px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--ink-3); font-weight:500; margin:0 0 6px;
  }
  h1{ font-size:clamp(20px,3.4vw,28px); line-height:1.2; margin:0 0 4px; font-weight:600; text-wrap:balance; }
  .sub{ color:var(--ink-2); font-size:14px; margin:0; }
  .docid{
    font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px;
    color:var(--ink-3); margin-top:8px; word-break:break-all;
  }

  .stats{ display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
  .stat{
    background:var(--surface); border:1px solid var(--line); border-radius:6px;
    padding:8px 12px; min-width:92px;
  }
  .stat .v{ font-family:"IBM Plex Mono",monospace; font-size:17px; font-weight:500;
            font-variant-numeric:tabular-nums; display:block; }
  .stat .k{ font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); }
  .stat.flag .v{ color:var(--warn); }

  .note{
    margin-top:16px; padding:12px 14px; border-left:3px solid var(--warn);
    background:var(--surface); font-size:13.5px; color:var(--ink-2); border-radius:0 5px 5px 0;
  }
  .note b{ color:var(--ink); font-weight:600; }

  /* document map ------------------------------------------------------ */
  .maprow{ margin:22px 0 6px; }
  .maplabel{ display:flex; justify-content:space-between; align-items:baseline;
             font-size:11px; letter-spacing:.1em; text-transform:uppercase;
             color:var(--ink-3); margin-bottom:6px; }
  .map{
    position:relative; height:40px; background:var(--rail);
    border:1px solid var(--line); border-radius:5px; overflow:hidden; cursor:pointer;
  }
  .map .mchunk{ position:absolute; top:0; height:26px; border-right:1px solid var(--surface); }
  .map .mpage{ position:absolute; bottom:0; height:14px; width:1px; background:var(--line-2); }
  .map .mlabel{ position:absolute; bottom:0; font-size:9px; color:var(--ink-3);
                font-family:"IBM Plex Mono",monospace; padding-left:2px; }

  /* controls ---------------------------------------------------------- */
  .controls{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:18px 0 14px; }
  button.toggle{
    font:inherit; font-size:12.5px; padding:6px 11px; border-radius:5px;
    border:1px solid var(--line-2); background:var(--surface); color:var(--ink-2); cursor:pointer;
  }
  button.toggle[aria-pressed="true"]{ background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  button.toggle:focus-visible, .map:focus-visible, .seg:focus-visible{ outline:2px solid var(--sel); outline-offset:2px; }
  .legend{ display:flex; flex-wrap:wrap; gap:14px; font-size:12px; color:var(--ink-2); margin-left:auto; }
  .legend span{ display:inline-flex; align-items:center; gap:6px; }
  .sw{ width:15px; height:15px; border-radius:3px; border:1px solid var(--line-2); display:inline-block; }
  .sw.ov{ background:repeating-linear-gradient(45deg,
          hsl(var(--c0) var(--tint-s) var(--tint-l)) 0 4px,
          hsl(var(--c1) var(--tint-s) var(--tint-l)) 4px 8px); }
  .sw.pl{ background:hsl(var(--c0) var(--tint-s) var(--tint-l)); }

  /* main -------------------------------------------------------------- */
  .cols{ display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:18px; align-items:start; }
  @media (max-width:900px){ .cols{ grid-template-columns:minmax(0,1fr); } }

  .stream{
    background:var(--surface); border:1px solid var(--line); border-radius:7px;
    padding:18px; font-family:"IBM Plex Mono",ui-monospace,monospace;
    font-size:12.5px; line-height:1.72; white-space:pre-wrap; overflow-wrap:break-word;
    max-height:74vh; overflow-y:auto;
  }
  .seg{ border-radius:2px; }
  .seg[data-own="1"]{ background:var(--tint); }
  .seg[data-own="2"]{ background:repeating-linear-gradient(45deg,
        var(--tintA) 0 5px, var(--tintB) 5px 10px); }
  .seg.dim{ background:none !important; color:var(--ink-3); }
  /* Selection recedes the rest rather than outlining the selection: an outline on
     a multi-line inline element draws a box around every line box, which turns the
     passage into a grid of boxes instead of one continuous highlight. */
  .stream.focused .seg{ opacity:.3; }
  .stream.focused .seg.hit{ opacity:1; filter:saturate(1.45) contrast(1.04); }
  .stream.focused .pagemark{ opacity:.45; }
  .stream.plain .seg{ background:none !important; }

  .pagemark{
    display:block; margin:14px 0 6px; padding-top:8px; border-top:1px dashed var(--line-2);
    font-family:"IBM Plex Sans",sans-serif; font-size:10.5px; letter-spacing:.1em;
    text-transform:uppercase; color:var(--ink-3); font-weight:500;
  }
  .stream.nopages .pagemark{ display:none; }

  /* inspector --------------------------------------------------------- */
  .inspect{ position:sticky; top:calc(env(safe-area-inset-top,0px) + 12px); }
  .panel{ background:var(--surface); border:1px solid var(--line); border-radius:7px; overflow:hidden; }
  .panel h2{ font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);
             margin:0; padding:11px 14px; border-bottom:1px solid var(--line); font-weight:500; }
  .panel .body{ padding:12px 14px; }
  .kv{ display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:12.5px; }
  .kv dt{ color:var(--ink-3); }
  .kv dd{ margin:0; font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums;
          word-break:break-all; }
  .pill{ display:inline-block; font-size:10.5px; padding:2px 7px; border-radius:99px;
         font-family:"IBM Plex Sans",sans-serif; letter-spacing:.04em; }
  .pill.span{ background:color-mix(in srgb, var(--warn) 16%, transparent); color:var(--warn); }
  .pill.one{ background:color-mix(in srgb, var(--good) 16%, transparent); color:var(--good); }
  table.spans{ width:100%; border-collapse:collapse; font-size:12px; margin-top:10px; }
  table.spans th{ text-align:left; font-weight:500; color:var(--ink-3); font-size:10.5px;
                  letter-spacing:.07em; text-transform:uppercase; padding:4px 6px 4px 0;
                  border-bottom:1px solid var(--line); }
  table.spans td{ padding:5px 6px 5px 0; border-bottom:1px solid var(--line);
                  font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; }
  .empty{ color:var(--ink-3); font-size:13px; }
  .chunklist{ max-height:230px; overflow-y:auto; }
  .chunklist button{
    display:grid; grid-template-columns:26px 1fr auto; gap:8px; width:100%; text-align:left;
    font:inherit; font-size:12px; background:none; border:0; border-bottom:1px solid var(--line);
    padding:7px 14px; cursor:pointer; color:var(--ink-2); align-items:center;
  }
  .chunklist button:hover{ background:var(--surface-2); }
  .chunklist button[aria-current="true"]{ background:var(--surface-2); color:var(--ink); font-weight:500; }
  .chunklist .dot{ width:11px; height:11px; border-radius:3px; display:inline-block; }
  .chunklist .pg{ font-family:"IBM Plex Mono",monospace; color:var(--ink-3); font-size:11px; }
  footer{ margin-top:28px; padding-top:14px; border-top:1px solid var(--line);
          font-size:12px; color:var(--ink-3); }
  code{ font-family:"IBM Plex Mono",monospace; background:var(--surface-2);
        padding:1px 5px; border-radius:3px; font-size:.92em; }
  @media (prefers-reduced-motion:reduce){ *{ transition:none !important; } }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">E2 · Ingestion and chunking</p>
    <h1>Chunk Boundary Inspector</h1>
    <p class="sub" id="sub"></p>
    <p class="docid" id="docid"></p>
    <div class="stats" id="stats"></div>
    <div class="note" id="note"></div>
  </header>

  <div class="maprow">
    <div class="maplabel"><span>Document map</span><span id="maphint">click to jump</span></div>
    <div class="map" id="map" tabindex="0" role="group" aria-label="Document map, click a chunk to inspect it"></div>
  </div>

  <div class="controls">
    <button class="toggle" id="tTint" aria-pressed="true">Chunk tint</button>
    <button class="toggle" id="tPages" aria-pressed="true">Page markers</button>
    <button class="toggle" id="tOverlap" aria-pressed="false">Overlap only</button>
    <div class="legend">
      <span><i class="sw pl"></i> one chunk</span>
      <span><i class="sw ov"></i> overlap, two chunks</span>
    </div>
  </div>

  <div class="cols">
    <div class="stream" id="stream" role="region" aria-label="Full document character stream"></div>
    <div class="inspect">
      <div class="panel">
        <h2>Chunk inspector</h2>
        <div class="body" id="inspector"><p class="empty">Select any tinted passage, or a bar on the map.</p></div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <h2>All chunks</h2>
        <div class="chunklist" id="chunklist"></div>
      </div>
    </div>
  </div>

  <footer>
    Generated by <code>tools/build_chunk_viewer.py</code> from live pipeline output.
    Offsets index into <code>walkthrough/text/&lt;name&gt;.text.txt</code>.
  </footer>
</div>

<script>
const D = __PAYLOAD__;
const HUES = [205,150,32,284,340,96,248,12];
const hue = o => HUES[o % HUES.length];
const tint = o => `hsl(${hue(o)} var(--tint-s) var(--tint-l))`;
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const n = x => x.toLocaleString();

const spanning = D.chunks.filter(c => c.spans_pages).length;
const maxPages = Math.max(...D.chunks.map(c => c.page_spans.length));

document.getElementById('sub').textContent =
  `${D.label} — the complete character stream, with every chunk boundary drawn on it.`;
document.getElementById('docid').textContent =
  `${D.document.document_id}  ·  chunker ${D.config.config_id}  ·  target ${D.config.target_chars} chars, overlap ${D.config.overlap_chars}`;

document.getElementById('stats').innerHTML = [
  ['characters', n(D.text.length)],
  ['pages', n(D.pages.length)],
  ['chunks', n(D.chunks.length)],
  ['chars / page', n(Math.round(D.text.length / D.pages.length))],
  ['span &gt;1 page', `${spanning} of ${D.chunks.length}`, true],
  ['widest chunk', `${maxPages} pages`, true],
].map(([k,v,flag]) =>
  `<div class="stat${flag?' flag':''}"><span class="v">${v}</span><span class="k">${k}</span></div>`
).join('');

document.getElementById('note').innerHTML =
  `<b>${spanning} of ${D.chunks.length} chunks cross a page boundary</b>, and the widest covers ${maxPages} pages. ` +
  `SDD 5.1 records a chunk as carrying a single page number; that is why this schema carries ` +
  `<code>page_start</code>, <code>page_end</code> and a <code>page_spans</code> list instead. ` +
  `Striped passages belong to two chunks at once, which is the ${D.config.overlap_chars}-character overlap.`;

/* ---- stream ---- */
const stream = document.getElementById('stream');
stream.innerHTML = D.segments.map((s, i) => {
  const body = esc(D.text.slice(s.a, s.b));
  const mark = s.page_start
    ? `<span class="pagemark">page ${s.page} · char ${n(s.a)}</span>` : '';
  if (!s.owners.length) return mark + `<span class="seg dim">${body}</span>`;
  const style = s.owners.length > 1
    ? `--tintA:${tint(s.owners[0])};--tintB:${tint(s.owners[1])}`
    : `--tint:${tint(s.owners[0])}`;
  const title = s.owners.length > 1
    ? `chars ${n(s.a)}–${n(s.b)} · shared by chunks ${s.owners.join(' and ')}`
    : `chars ${n(s.a)}–${n(s.b)} · chunk ${s.owners[0]}`;
  return mark + `<span class="seg" tabindex="0" role="button" data-own="${s.owners.length}"`
    + ` data-chunk="${s.owners[0]}" data-i="${i}" style="${style}" title="${title}">${body}</span>`;
}).join('');

/* ---- map ---- */
const map = document.getElementById('map');
const total = D.text.length;
map.innerHTML =
  D.chunks.map(c => {
    const left = (c.a / total * 100).toFixed(3), w = ((c.b - c.a) / total * 100).toFixed(3);
    const row = c.ordinal % 2 ? 13 : 0;
    return `<div class="mchunk" data-chunk="${c.ordinal}" title="chunk ${c.ordinal} · pages ${c.page_start}–${c.page_end}"`
      + ` style="left:${left}%;width:${w}%;top:${row}px;height:13px;background:${tint(c.ordinal)}"></div>`;
  }).join('') +
  D.pages.map(p => `<div class="mpage" style="left:${(p.a / total * 100).toFixed(3)}%"></div>`).join('') +
  `<span class="mlabel" style="left:2px">char 0</span>` +
  `<span class="mlabel" style="right:4px">${n(total)}</span>`;

/* ---- chunk list ---- */
const list = document.getElementById('chunklist');
list.innerHTML = D.chunks.map(c =>
  `<button data-chunk="${c.ordinal}">
     <i class="dot" style="background:${tint(c.ordinal)}"></i>
     <span>${c.chunk_id.slice(0, 14)}…</span>
     <span class="pg">p${c.page_start}${c.spans_pages ? '–' + c.page_end : ''}</span>
   </button>`).join('');

/* ---- inspector ---- */
let selected = null;
function select(ordinal, scroll = true) {
  const c = D.chunks[ordinal];
  if (!c) return;
  selected = ordinal;

  stream.classList.add('focused');
  document.querySelectorAll('.seg.hit').forEach(el => el.classList.remove('hit'));
  document.querySelectorAll(`.seg[data-chunk]`).forEach(el => {
    const own = D.segments[+el.dataset.i].owners;
    if (own.includes(ordinal)) el.classList.add('hit');
  });
  list.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-current', String(+b.dataset.chunk === ordinal)));

  const rows = c.page_spans.map(s => `<tr>
      <td>${s.page}</td><td>${n(s.a)}–${n(s.b)}</td>
      <td>${n(s.pa)}–${n(s.pb)}</td><td>${s.rects}</td></tr>`).join('');

  document.getElementById('inspector').innerHTML = `
    <dl class="kv">
      <dt>chunk_id</dt><dd>${c.chunk_id}</dd>
      <dt>ordinal</dt><dd>${c.ordinal}</dd>
      <dt>chars</dt><dd>${n(c.a)}–${n(c.b)} <span style="color:var(--ink-3)">(${n(c.len)})</span></dd>
      <dt>pages</dt><dd>${c.page_start}${c.spans_pages ? '–' + c.page_end : ''}
        <span class="pill ${c.spans_pages ? 'span' : 'one'}">${c.spans_pages ? c.page_spans.length + ' pages' : 'single page'}</span></dd>
      <dt>tokens</dt><dd>~${n(c.tokens)}</dd>
      <dt>citations</dt><dd>${c.citations}</dd>
      <dt>checksum</dt><dd style="font-size:11px">${c.checksum.slice(0, 32)}…</dd>
    </dl>
    <table class="spans">
      <thead><tr><th>page</th><th>doc offsets</th><th>page offsets</th><th>rects</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:12px;color:var(--ink-3);margin:10px 0 0">
      ${c.page_spans.length} page span${c.page_spans.length > 1 ? 's' : ''} →
      ${c.citations} citation target${c.citations > 1 ? 's' : ''}, each with its own highlight rectangles.
    </p>`;

  // Scroll inside the stream panel only. scrollIntoView would move the whole
  // window and push the masthead out of frame.
  if (!scroll) return;
  const first = stream.querySelector(`.seg.hit`);
  if (!first) return;
  const top = first.offsetTop - stream.offsetTop - stream.clientHeight / 3;
  stream.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-chunk]');
  if (t) select(+t.dataset.chunk);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest('.seg[data-chunk]');
  if (t) { e.preventDefault(); select(+t.dataset.chunk); }
});

/* ---- toggles ---- */
function toggle(id, fn) {
  const b = document.getElementById(id);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    fn(on);
  });
}
toggle('tTint', on => stream.classList.toggle('plain', !on));
toggle('tPages', on => stream.classList.toggle('nopages', !on));
toggle('tOverlap', on => {
  stream.querySelectorAll('.seg').forEach(el => {
    if (el.dataset.own !== '2') el.classList.toggle('dim', on);
  });
});

// Open on the first page-spanning chunk, which is the thing the page exists to
// show, but without scrolling: the masthead belongs in the first frame.
const opening = D.chunks.findIndex(c => c.spans_pages);
select(opening >= 0 ? opening : 0, false);
</script>
'''

if __name__ == '__main__':
    main()
