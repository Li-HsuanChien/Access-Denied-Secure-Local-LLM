import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Explicit disposable endpoint: never forward to the user's normal host.
const frontend = path.resolve(process.env.REACT_FRONTEND_DIR ?? 'app/document-qa/frontend');
const require = createRequire(path.join(frontend, 'package.json'));
const { chromium } = require('playwright');
const appOrigin = 'http://127.0.0.1:4177';
const hostOrigin = 'http://127.0.0.1:8767';
assert.equal(process.env.SECURE_QA_REAL_SMOKE_HOST, hostOrigin);
const output = process.env.REACT_REAL_SMOKE_OUTPUT;
assert(output && path.isAbsolute(output));
await fs.mkdir(output, { recursive: true });
const source = 'The fictional Alder station maintenance window is Tuesday from 09:00 to 11:00. Supervisor Mira must approve maintenance before work begins.';
const question = 'When is the Alder station maintenance window, and who must approve the work?';
function pdf(text) {
  const stream = `BT /F1 10 Tf 35 760 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
const document = pdf(source);
await fs.writeFile(path.join(output, 'alder-station.pdf'), document);
const requests = [], errors = [], blocked = [];
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), args: ['--disable-background-networking'] });
let outcome = 'failed';
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => { localStorage.theme = 'light'; localStorage.sidebar = 'false'; });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:8765') {
      assert(['/health', '/v1/requests'].includes(url.pathname) && !url.search);
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
      const payload = url.pathname === '/v1/requests' ? request.postDataJSON() : null;
      const entry = { operation: payload?.operation ?? 'health', request_id: payload?.request_id ?? null, started: new Date().toISOString() };
      requests.push(entry);
      const response = await route.fetch({ url: `${hostOrigin}${url.pathname}`, maxRedirects: 0, timeout: 600_000 });
      const body = await response.json();
      Object.assign(entry, { status: response.status(), result: body, ended: new Date().toISOString() });
      return route.fulfill({ status: response.status(), json: body, headers: { 'Access-Control-Allow-Origin': appOrigin } });
    }
    if (url.origin === appOrigin) return route.continue();
    blocked.push(url.href); return route.abort('blockedbyclient');
  });
  await page.goto(`${appOrigin}/library`);
  await page.locator('#pdfs').setInputFiles({ name: 'alder-station.pdf', mimeType: 'application/pdf', buffer: document });
  await page.getByRole('button', { name: 'Review selected files', exact: true }).click();
  await page.getByRole('heading', { name: 'Review import' }).waitFor();
  await page.getByRole('button', { name: 'Publish accepted PDFs', exact: true }).click();
  await page.getByText(/Collection .* is active · 1 PDFs/).waitFor({ timeout: 180_000 });
  // Readiness is an explicit refresh in the preserved interface.
  await page.locator('.service-status').getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('.service-status').getByText('Local workspace', { exact: true }).waitFor();
  await page.locator('.service-status').getByText(/local model ready/).waitFor();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const knowledge = page.locator('label.setting').filter({ hasText: 'Include general model knowledge by default' }).getByRole('switch');
  if (await knowledge.isChecked()) await knowledge.click();
  await page.waitForFunction(() => ![...document.querySelectorAll('label.setting')].find(x => x.textContent.includes('Include general model knowledge by default'))?.querySelector('input')?.checked);
  const history = page.locator('label.setting').filter({ hasText: 'Save new answers to local conversation history' }).getByRole('switch');
  if (!await history.isChecked()) await history.click();
  await page.getByRole('link', { name: 'New Chat', exact: true }).click();
  await page.locator('#chat-input').fill(question);
  await page.locator('#chat-input').press('Enter');
  const deadline = Date.now() + 600_000;
  while (!requests.some(x => x.operation === 'history.save' && x.ended)) {
    assert(Date.now() < deadline, 'Real answering/history save did not finish in ten minutes');
    await page.waitForTimeout(250);
  }
  const answer = requests.find(x => x.operation === 'answering.ask').result.result;
  assert.equal(answer.status, 'answered', JSON.stringify(answer));
  assert(answer.documents.length && answer.citations.length);
  const claims = answer.documents.map(x => x.text).join('\n');
  assert(/Tuesday/i.test(claims) && /Mira/i.test(claims), claims);
  assert(answer.citations.every(x => x.source_filename === 'alder-station.pdf' && x.page_start === 1));
  assert.equal(requests.find(x => x.operation === 'history.save').result.result.saved, true);
  await page.getByRole('button', { name: /Toggle \d+ source/i }).first().click();
  await page.screenshot({ path: path.join(output, 'answer-sources.png'), fullPage: true });
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.locator('li.row button.open').first().click();
  await page.getByRole('heading', { name: question, exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'saved-answer.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  outcome = 'passed';
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ outcome, source, question, appOrigin, hostOrigin, browserVersion: browser.version(), requests, errors, blocked }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ outcome, output, operations: requests.map(x => x.operation), errors, blocked }));
}
