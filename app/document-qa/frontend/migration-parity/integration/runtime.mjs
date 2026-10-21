import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createFixtureState, health, respond } from '../fixtures/responses.mjs';

export const appOrigin = process.env.REACT_INTEGRATION_ORIGIN ?? 'http://127.0.0.1:5176';
const appUrl = new URL(appOrigin);
assert.equal(appUrl.protocol, 'http:');
assert.equal(appUrl.hostname, '127.0.0.1');
assert(!['8765', '8766'].includes(appUrl.port), 'The app origin must be a frontend, not a host endpoint.');
export const mode = process.env.REACT_INTEGRATION_MODE ?? 'fixture';
assert(['fixture', 'host'].includes(mode), 'REACT_INTEGRATION_MODE must be fixture or host.');
export const hostOrigin = process.env.SECURE_QA_TEST_HOST_URL;
if (mode === 'host') assert.equal(hostOrigin, 'http://127.0.0.1:8766', 'Host mode requires the explicit disposable endpoint.');
export const output = process.env.REACT_INTEGRATION_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'react-integration-'));
await fs.mkdir(output, { recursive: true });
export const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), args: ['--disable-background-networking'] });
export const reports = [];
export const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
export async function until(predicate, message = 'Condition did not settle') {
  const deadline = performance.now() + 15_000;
  while (!predicate()) {
    assert(performance.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
export async function settle(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
export async function session({ name, fixtureMode = 'answer', handle, routePath = '/qa' }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => { localStorage.theme = 'light'; localStorage.sidebar = 'false'; });
  const page = await context.newPage(), state = createFixtureState(), requests = [], errors = [], blocked = [];
  state.mode = fixtureMode;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:8765') {
      assert(['/health', '/v1/requests'].includes(url.pathname) && !url.search, `Unmapped API path: ${url.href}`);
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
      const body = url.pathname === '/v1/requests' ? request.postDataJSON() : null;
      const entry = { operation: body?.operation ?? 'health', request_id: body?.request_id ?? null, payload: body?.payload ?? null, start: performance.now(), end: null };
      requests.push(entry);
      const forward = async () => {
        if (mode === 'fixture') return body ? respond(state, body) : { status: 200, body: health(fixtureMode) };
        const response = await route.fetch({ url: `${hostOrigin}${url.pathname}`, maxRedirects: 0, timeout: 60_000 });
        return { status: response.status(), body: await response.json() };
      };
      const result = await (handle ? handle(body, forward, state, entry) : forward());
      entry.end = performance.now(); entry.status = result.status; entry.result = result.body;
      return route.fulfill({ status: result.status, json: result.body, headers: { 'Access-Control-Allow-Origin': appOrigin } });
    }
    if (url.origin === appOrigin) return route.continue();
    blocked.push(url.href); return route.abort('blockedbyclient');
  });
  await page.goto(`${appOrigin}${routePath}`); await settle(page);
  return {
    page, state, requests,
    operations: operation => requests.filter(request => request.operation === operation),
    async close() {
      await settle(page);
      assert.deepEqual(errors, [], `${name}: browser errors`);
      assert.deepEqual(blocked, [], `${name}: unexpected requests`);
      reports.push({ name, mode, requests, errors, blocked });
      await context.close();
    }
  };
}
export async function send(page, text) { await page.locator('#chat-input').fill(text); await page.locator('#chat-input').press('Enter'); }
export async function idle(page) { await page.waitForFunction(() => !document.querySelector('.chat-queue') && !document.querySelector('[aria-label="Answer in progress"]')); }
export async function navigate(page, name) { await page.getByRole('link', { name, exact: true }).click(); }
export async function committed(locator, value) {
  if (await locator.isChecked() !== value) await locator.click();
  await locator.page().waitForFunction(({ selector, checked }) => document.querySelector(selector)?.checked === checked, { selector: await locator.evaluate(node => { if (!node.dataset.integrationId) node.dataset.integrationId = crypto.randomUUID(); return `[data-integration-id="${node.dataset.integrationId}"]`; }), checked: value });
}
export async function finish() {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ mode, appOrigin, hostOrigin: mode === 'host' ? hostOrigin : null, browserExecutable: chromium.executablePath(), browserVersion: browser.version(), reports }, null, 2));
  console.log(JSON.stringify({ mode, output, cases: reports.map(report => ({ name: report.name, operations: Object.fromEntries([...new Set(report.requests.map(request => request.operation))].map(operation => [operation, report.requests.filter(request => request.operation === operation).length])), errors: report.errors.length, blocked: report.blocked.length })) }, null, 2));
}

/** A real text PDF generated locally; no downloads or backend fixture switch. */
export function textPdf(text = 'Local integration fixture preserves source evidence and approved dose limits.', pages = 1) {
  const objects = [], pageIds = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const pageId of pageIds) {
    const stream = `BT /F1 12 Tf 50 760 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let document = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}
