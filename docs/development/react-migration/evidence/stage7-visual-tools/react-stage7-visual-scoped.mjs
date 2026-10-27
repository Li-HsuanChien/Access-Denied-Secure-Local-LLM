import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const reviewRepoRoot=process.env.PARITY_REPO_ROOT||process.cwd();
const {createFixtureState,health,respond}=await import(path.join(reviewRepoRoot,'app/document-qa/frontend/migration-parity/fixtures/responses.mjs'));

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE || path.join(reviewRepoRoot,'app/document-qa/frontend/node_modules/playwright');
const { chromium } = playwrightPath ? require(playwrightPath) : require('playwright');

const root = path.dirname(new URL(import.meta.url).pathname);
// Keep writes outside Vite's watched tree. Writing capture JSON into the
// frontend during a run triggers a full reload and clears transient chat state.
const outputRoot = path.resolve(process.env.BASELINE_OUTPUT_ROOT || '/private/tmp/react-stage7-visual-scoped');
const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docqa-parity-capture-'));
const shots = path.join(stagingRoot, 'screenshots');
const metadata = path.join(stagingRoot, 'metadata');
const origin = process.env.BASELINE_ORIGIN || 'http://127.0.0.1:4177';
// The accepted originals used full Chromium. Playwright's default headless
// launch can select headless-shell, whose rasterization differs at the same version.
const browserPath = process.env.PLAYWRIGHT_EXECUTABLE || chromium.executablePath();

await fs.mkdir(shots, { recursive: true });
await fs.mkdir(metadata, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ['--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync'] });
const version = browser.version();
const blocked = [];
const browserErrors = [];
const cases = [];

async function newPage({ width = 1440, height = 1000, theme = 'light', sidebar = 'expanded', apiMode = 'answer' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: theme === 'dark' ? 'dark' : 'light', timezoneId: 'America/New_York' });
  await context.addInitScript(({ theme, sidebar }) => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('sidebar', sidebar === 'collapsed' ? 'false' : 'true');
    const NativeDate = Date;
    const epoch = NativeDate.parse('2026-10-20T12:00:00.000Z');
    const started = performance.now();
    const FixedDate = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch + performance.now() - started])); }
      static now() { return epoch + performance.now() - started; }
    };
    window.Date = FixedDate;
    let n = 0;
    try { Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }); } catch {}
    let seed = 20261020;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  }, { theme, sidebar });
  const page = await context.newPage();
  const fixtureState = createFixtureState();
  fixtureState.mode = apiMode;
  if (apiMode === 'history-empty' || apiMode === 'history-loading') fixtureState.records = [];
  page.on('pageerror', error => browserErrors.push({ type: 'pageerror', url: page.url(), message: error.message }));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push({ type: 'console', url: page.url(), location: message.location(), message: message.text() }); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === '8765') {
      if (url.pathname === '/health') return route.fulfill({ json: health(apiMode) });
      if (url.pathname !== '/v1/requests') return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Unknown path', hint: '' } } });
      const payload = route.request().postDataJSON();
      const response = await respond(fixtureState, payload);
      await route.fulfill({ status: response.status, json: response.body });
      return;
    }
    if (url.origin === origin) return route.continue();
    blocked.push({ url: url.href, reason: 'outbound request denied' });
    await route.abort('blockedbyclient');
  });
  return { page, context };
}

async function capture(name, page, details = {}) {
  await page.locator('.desktop-shell').waitFor({ state: 'visible', timeout: 15000 });
  if (['/qa', '/', '/c/baseline-session'].includes(details.route)) await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 15000 });
  else await page.locator('#main-content h1').waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const typedTextBefore = details.state === 'typed multiline composer' ? await page.locator('#chat-input').innerText() : null;
  if (details.state === 'typed multiline composer' && (!typedTextBefore?.includes('What does the local library preserve?') || !typedTextBefore?.includes('Include the source details.'))) throw new Error(`Typed composer state cleared before screenshot: ${JSON.stringify(typedTextBefore)}`);
  const screenshotPath = path.join(shots, `${name}.png`);
  await page.screenshot({ path: screenshotPath, animations: 'disabled', fullPage: details.viewportOnly !== true && details.state !== 'typed multiline composer' });
  const screenshotSha256 = createHash('sha256').update(await fs.readFile(screenshotPath)).digest('hex');
  if (typedTextBefore !== null && await page.locator('#chat-input').innerText() !== typedTextBefore) throw new Error('Typed composer changed during screenshot; reference was not accepted.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const perfMetrics = (await cdp.send('Performance.getMetrics')).metrics;
  await cdp.detach();
  const observed = await page.evaluate(() => {
    const selectors = ['body', '.desktop-shell', '#sidebar', '#main-content', '#chat-container', '#messages-container', '#chat-input-container', '#chat-input', '#send-message-button', 'h1', '.panel', '.composer', '.markdown-prose', '.markdown-prose table', '.markdown-prose pre', '.markdown-prose svg', '.markdown-prose .katex', 'textarea', 'button', 'nav'];
    const styles = {};
    for (const selector of selectors) {
      const matches = document.querySelectorAll(selector);
      const node = selector === '.markdown-prose' ? matches[matches.length - 1] : matches[0];
      if (!node) continue;
      const cs = getComputedStyle(node), rect = node.getBoundingClientRect();
      styles[selector] = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, color: cs.color, backgroundColor: cs.backgroundColor, fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight, borderRadius: cs.borderRadius, padding: cs.padding, margin: cs.margin, display: cs.display };
    }
    const messages = document.querySelector('#messages-container');
    const markdownNodes = document.querySelectorAll('.markdown-prose');
    const markdown = markdownNodes[markdownNodes.length - 1];
    return { title: document.title, url: location.href, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, themeClass: document.documentElement.className, scroll: messages ? { top: messages.scrollTop, height: messages.scrollHeight, clientHeight: messages.clientHeight } : null, renderer: markdown ? { tables: markdown.querySelectorAll('table').length, codeBlocks: markdown.querySelectorAll('pre').length, mermaid: markdown.querySelectorAll('.mermaid-diagram svg').length, vegaSvgMarks: markdown.querySelectorAll('svg.marks').length, math: markdown.querySelectorAll('.katex').length, details: markdown.querySelectorAll('details').length } : null, styles };
  });
  const typedText = typedTextBefore ?? (await page.locator('#chat-input').count() ? await page.locator('#chat-input').innerText() : null);
  const record = { case: name, capturedAt: '2026-10-20T12:00:00.000Z', browser: `Chromium ${version}`, screenshotSha256, performance: Object.fromEntries(perfMetrics.filter(item => ['JSHeapUsedSize', 'Nodes', 'Documents', 'LayoutCount'].includes(item.name)).map(item => [item.name, item.value])), viewport: observed.viewport, composerText: typedText, details, ...observed };
  await fs.writeFile(path.join(metadata, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  cases.push(record);
}

async function visit(name, route, opts = {}) {
  const { page, context } = await newPage(opts);
  await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.locator('.desktop-shell').waitFor({ state: 'visible', timeout: 15000 });
  if (['/qa', '/', '/c/baseline-session'].includes(route)) await page.getByText(/Summarize the key points/i).waitFor({ state: 'visible', timeout: 20000 });
  else await page.locator('#main-content h1').waitFor({ state: 'visible', timeout: 15000 });
  // Vite may replace the page while optimizing the native Chat dependency graph.
  // Visible markup alone can precede that reload; wait for initial module requests
  // and initialization to finish before manipulating a contenteditable composer.
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await capture(name, page, { route, ...opts });
  return { page, context };
}

async function captureChatState(name, apiMode, expectedText, { inFlight = false, richResponse = false, longResponse = false } = {}) {
  const { page, context } = await visit(`${name}-initial`, '/qa', { width: 1440, height: 1000, theme: 'light', sidebar: 'expanded', apiMode });
  await page.locator('button').filter({ hasText: 'Summarize the key points' }).click();
  if (inFlight) {
    await page.waitForTimeout(300);
    await capture(name, page, { route: '/qa', state: 'in-flight answer request' });
  }
  await page.getByText(new RegExp(expectedText, 'i')).first().waitFor({ timeout: 15000 });
  const responseState = { route: '/qa', state: expectedText, ...(richResponse ? { response: 'rich Markdown and renderer formats' } : {}), ...(longResponse ? { response: 'long Markdown content' } : {}) };
  if (richResponse || longResponse) {
    const scroller = page.locator('#messages-container');
    await page.locator('#messages-container .markdown-prose').last().waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    const positions = richResponse ? [['top', 0], ['middle', 0.5], ['bottom', 1]] : [['top', 0], ['bottom', 1]];
    for (const [position, fraction] of positions) {
      await scroller.evaluate((element, ratio) => { element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) * ratio); }, fraction);
      await page.waitForTimeout(200);
      const prefix = richResponse ? 'chat-rich-content' : 'chat-long-content';
      await capture(`${prefix}-${position}`, page, { ...responseState, scrollPosition: position, viewportOnly: true });
    }
  } else {
    await capture(inFlight ? `${name}-complete` : name, page, responseState);
  }
  await context.close();
}

async function uploadFixture(page, selectedName = null) {
  await page.locator('#pdfs').setInputFiles([
    { name: 'accepted-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% deterministic fixture') },
    { name: 'rejected-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid test payload') }
  ]);
  if (selectedName) await capture(selectedName, page, { route: '/library', state: 'selected file list before review' });
  await page.getByRole('button', { name: /review selected files/i }).click();
  await page.getByRole('heading', { name: 'Review import' }).waitFor({ state: 'visible' });
}

// Preference switches display host-confirmed state. Playwright's uncheck()
// checks synchronously after clicking, before an asynchronous write may settle.
async function disablePreference(page, input) {
  if (await input.isChecked()) await input.click();
  await page.waitForFunction(element => !element.checked, await input.elementHandle());
}

try {
 const opts={width:1440,height:1000,theme:'light',sidebar:'collapsed'};
 const {page,context}=await visit('chat-answer-initial','/qa',opts);
 await page.locator('button').filter({hasText:'Summarize the key points'}).click();
 await page.getByText(/From your documents/i).first().waitFor({timeout:15000});
 await capture('chat-answer',page,{route:'/qa',state:'supported answer'});
 await page.getByRole('button',{name:/Toggle 1 source/i}).first().click();
 await capture('chat-sources-expanded',page,{route:'/qa',state:'expanded source'});
 await page.getByText(/QA Reference Guide · p\. 2/i).click();
 await capture('chat-source-detail-modal',page,{route:'/qa',state:'source detail modal'});
 await context.close();
 await captureChatState('chat-rich-content','rich','Rich response',{richResponse:true});
 const summary={scope:'Stage7 scoped renderer follow-up; safe existing fixtures; six affected states plus two setup captures',browser:`Chromium ${version}`,browserExecutable:browserPath,origin,fixtureApi:'intercepted local workflow responses; no host writes',cases:cases.map(({case:name,viewport,screenshotSha256,details})=>({name,viewport,screenshotSha256,details})),blockedRequests:blocked,browserErrors};
 await fs.writeFile(path.join(stagingRoot,'capture-index.json'),JSON.stringify(summary,null,2)+'\n');
 await fs.mkdir(outputRoot,{recursive:false});await fs.cp(stagingRoot,outputRoot,{recursive:true});console.log(JSON.stringify({captured:cases.length,blockedRequests:blocked.length,browserErrors,outputRoot},null,2));
} finally {await browser.close();}
