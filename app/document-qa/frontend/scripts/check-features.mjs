// Keep the strict QA gate scoped to owned code, as tsconfig.qa.json intends.
// svelte-check also reports transitive vendored Open WebUI sources despite include.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  'node_modules/svelte-check/bin/svelte-check', '--tsconfig', './tsconfig.qa.json',
  '--output', 'machine-verbose'
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
let completed = false;
let errors = 0;
let upstream = 0;
let failure = Boolean(result.error || ![0, 1].includes(result.status));
for (const line of (result.stdout ?? '').split(/\r?\n/)) {
  const record = line.replace(/^\d+\s+/, '');
  if (record.startsWith('COMPLETED ')) completed = true;
  if (record.startsWith('FAILURE ')) { console.error(record); failure = true; }
  if (!record.startsWith('{')) continue;
  let diagnostic;
  try { diagnostic = JSON.parse(record); } catch { failure = true; continue; }
  const filename = String(diagnostic.filename ?? '').replaceAll('\\', '/');
  // Only known imported upstream paths are excluded. Config/global/owned errors fail.
  if (/(^|\/)src\/lib\/(components\/|utils\/|stores\/|apis\/|constants\.ts$)/.test(filename)) {
    upstream++;
    continue;
  }
  if (diagnostic.type === 'ERROR') errors++;
  console.log(`${diagnostic.type} ${filename}:${diagnostic.start?.line}:${diagnostic.start?.character} ${diagnostic.message}`);
}
if (result.stderr) process.stderr.write(result.stderr);
if (!completed || failure) {
  console.error(result.error ?? result.stdout ?? 'svelte-check did not complete');
  process.exitCode = 1;
} else {
  console.log(`QA check: ${errors} errors; ${upstream} imported upstream diagnostics outside the QA gate.`);
  process.exitCode = errors ? 1 : 0;
}
