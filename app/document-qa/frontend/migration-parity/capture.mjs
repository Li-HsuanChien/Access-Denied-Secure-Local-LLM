import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createFixtureState, health, respond } from './fixtures/responses.mjs';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = playwrightPath ? require(playwrightPath) : require('playwright');

const root = path.dirname(new URL(import.meta.url).pathname);
// Keep writes outside Vite's watched tree. Writing capture JSON into the
// frontend during a run triggers a full reload and clears transient chat state.
const outputRoot = path.resolve(process.env.BASELINE_OUTPUT_ROOT || path.join(root, 'original'));
const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docqa-parity-capture-'));
const shots = path.join(stagingRoot, 'screenshots');
const metadata = path.join(stagingRoot, 'metadata');
const origin = process.env.BASELINE_ORIGIN || 'http://127.0.0.1:5173';
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
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      const viewport = width === 390 ? { width, height: 844 } : { width, height: 1000 };
      const chatOpts = { ...viewport, theme, ...(width === 1440 ? { sidebar: 'collapsed' } : {}) };
      const { page, context } = await visit(`chat-empty-${theme}-${width}`, '/qa', chatOpts);
      if (width === 1440 && theme === 'light') {
        const initialHash = cases.at(-1).screenshotSha256;
        const { context: repeatContext } = await visit('chat-empty-light-1440-repeat', '/qa', chatOpts);
        if (cases.at(-1).screenshotSha256 !== initialHash) throw new Error(`Independent repeated empty baseline image differs: ${initialHash} versus ${cases.at(-1).screenshotSha256}`);
        await repeatContext.close();
        const { page: typedPage, context: typedContext } = await visit('chat-typed-multiline-initial', '/qa', chatOpts);
        await typedPage.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const input = typedPage.locator('#chat-input');
        await input.click();
        await input.pressSequentially('What does the local library preserve?');
        await input.press('Shift+Enter');
        await input.pressSequentially('Include the source details.');
        const typedText = await input.innerText();
        if (!typedText.includes('What does the local library preserve?') || !typedText.includes('Include the source details.') || !(await typedPage.locator('#send-message-button').isEnabled())) throw new Error(`Multiline composer did not retain typed text and enable send: ${JSON.stringify(typedText)}`);
        await capture('chat-typed-multiline', typedPage, { route: '/qa', state: 'typed multiline composer' });
        await typedContext.close();

        const { page: answerPage, context: answerContext } = await visit('chat-answer-initial', '/qa', chatOpts);
        await answerPage.locator('button').filter({ hasText: 'Summarize the key points' }).click();
        await answerPage.getByText(/From your documents/i).first().waitFor({ timeout: 15000 });
        await capture('chat-answer', answerPage, { route: '/qa', state: 'supported answer' });
        await answerPage.getByRole('button', { name: /Toggle 1 source/i }).first().click();
        await capture('chat-sources-expanded', answerPage, { route: '/qa', state: 'expanded source' });
        await answerPage.getByText(/QA Reference Guide · p\. 2/i).click();
        await capture('chat-source-detail-modal', answerPage, { route: '/qa', state: 'source detail modal' });
        await answerContext.close();
      }
      await context.close();
    }
  }

  // Real routed Chat.svelte surfaces with deterministic workflow wire fixtures.
  await captureChatState('chat-insufficient-evidence', 'insufficient', 'There is not enough evidence');
  await captureChatState('chat-request-failure', 'failure', 'The local QA service is unavailable');
  await captureChatState('chat-history-save-failure', 'history-save-failure', 'could not be saved to local history');
  await captureChatState('chat-rich-content', 'rich', 'Rich response', { richResponse: true });
  await captureChatState('chat-long-content', 'long', 'Additional section', { longResponse: true });
  await captureChatState('chat-in-flight', 'answer-delay', 'From your documents', { inFlight: true });

  // Sidebar hover/focus, expanded desktop and mobile overlay states.
  const { page: hoverPage, context: hoverContext } = await visit('chat-suggestion-hover-focus', '/qa', { width: 1440, height: 1000, theme: 'light', sidebar: 'expanded' });
  const suggestion = hoverPage.locator('button').filter({ hasText: 'Summarize the key points' });
  await suggestion.hover();
  await capture('chat-suggestion-hover', hoverPage, { route: '/qa', state: 'suggestion hover' });
  await suggestion.focus();
  await capture('chat-suggestion-focus', hoverPage, { route: '/qa', state: 'suggestion keyboard focus' });
  await hoverContext.close();
  for (const theme of ['light', 'dark']) {
    const { page, context } = await visit(`chat-sidebar-expanded-${theme}-initial`, '/qa', { width: 1440, height: 1000, theme, sidebar: 'expanded' });
    await capture(`chat-sidebar-expanded-${theme}`, page, { route: '/qa', state: 'expanded sidebar', theme });
    await context.close();
  }
  const { page: mobilePage, context: mobileContext } = await visit('chat-mobile-sidebar-overlay-initial', '/qa', { width: 390, height: 844, theme: 'light', sidebar: 'collapsed' });
  await mobilePage.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await capture('chat-mobile-sidebar-overlay', mobilePage, { route: '/qa', state: 'mobile sidebar overlay' });
  await mobileContext.close();

  // Library review and publication workflow states.
  const { page: reviewPage, context: reviewContext } = await visit('library-initial-narrow', '/library', { width: 390, height: 844, theme: 'light' });
  await reviewContext.close();
  const { page: libraryReviewPage, context: libraryReviewContext } = await visit('library-review-unchecked-initial', '/library', { width: 1440, height: 1000, theme: 'light' });
  await uploadFixture(libraryReviewPage, 'library-files-selected');
  await capture('library-review-unchecked', libraryReviewPage, { route: '/library', state: 'accepted and rejected files; confirmation unchecked' });
  await libraryReviewPage.getByRole('checkbox').check();
  await capture('library-review-checked', libraryReviewPage, { route: '/library', state: 'confirmation checked' });
  await libraryReviewContext.close();
  const { page: libraryReviewDarkPage, context: libraryReviewDarkContext } = await visit('library-review-dark-initial', '/library', { width: 1440, height: 1000, theme: 'dark' });
  await uploadFixture(libraryReviewDarkPage, 'library-files-selected-dark');
  await capture('library-review-unchecked-dark', libraryReviewDarkPage, { route: '/library', state: 'accepted and rejected files; confirmation unchecked' });
  await libraryReviewDarkPage.getByRole('checkbox').check();
  await capture('library-review-checked-dark', libraryReviewDarkPage, { route: '/library', state: 'confirmation checked' });
  await libraryReviewDarkContext.close();
  const { page: libraryReviewNarrowPage, context: libraryReviewNarrowContext } = await visit('library-review-narrow-initial', '/library', { width: 390, height: 844, theme: 'light' });
  await uploadFixture(libraryReviewNarrowPage);
  await capture('library-review-narrow', libraryReviewNarrowPage, { route: '/library', state: 'review at narrow viewport' });
  await libraryReviewNarrowContext.close();
  const { page: publishPage, context: publishContext } = await visit('library-publication-progress-initial', '/library', { width: 1440, height: 1000, theme: 'light', apiMode: 'library-publishing' });
  await uploadFixture(publishPage);
  await publishPage.getByRole('checkbox').check();
  await publishPage.getByRole('button', { name: /publish accepted PDFs/i }).click();
  await publishPage.getByRole('heading', { name: 'Publication in progress' }).waitFor({ state: 'visible' });
  await capture('library-publication-progress', publishPage, { route: '/library', state: 'publication progress' });
  await publishPage.getByText(/Collection fixture-v2 is active/i).waitFor({ timeout: 5000 });
  await capture('library-publication-result', publishPage, { route: '/library', state: 'publication result' });
  await publishPage.getByRole('button', { name: /roll back to previous version/i }).click();
  await publishPage.getByText(/Collection fixture-v1 is active again/i).waitFor();
  await capture('library-rollback-result', publishPage, { route: '/library', state: 'rollback result' });
  await publishContext.close();
  const { page: cancelPage, context: cancelContext } = await visit('library-cancelable', '/library', { width: 1440, height: 1000, theme: 'light', apiMode: 'library-cancelable' });
  await uploadFixture(cancelPage);
  await cancelPage.getByRole('checkbox').check();
  await cancelPage.getByRole('button', { name: /publish accepted PDFs/i }).click();
  await cancelPage.getByRole('heading', { name: 'Publication in progress' }).waitFor({ state: 'visible' });
  await cancelPage.getByRole('button', { name: /cancel publication/i }).click();
  await cancelPage.getByRole('alert').waitFor({ state: 'visible' });
  await capture('library-cancellation-result', cancelPage, { route: '/library', state: 'cancellation result; active version unchanged' });
  await cancelContext.close();
  const { page: libraryFailurePage, context: libraryFailureContext } = await visit('library-publication-failure-initial', '/library', { width: 1440, height: 1000, theme: 'dark', apiMode: 'library-failure' });
  await uploadFixture(libraryFailurePage);
  await libraryFailurePage.getByRole('checkbox').check();
  await libraryFailurePage.getByRole('button', { name: /publish accepted PDFs/i }).click();
  await libraryFailurePage.getByRole('alert').waitFor({ state: 'visible' });
  await capture('library-publication-failure', libraryFailurePage, { route: '/library', state: 'publication failure and unchanged active collection' });
  await libraryFailureContext.close();

  // History states: empty, list, open answer with source, persistence, delete and clear.
  const { page: historyEmptyPage, context: historyEmptyContext } = await visit('history-empty', '/history', { width: 1440, height: 1000, theme: 'light', apiMode: 'history-empty' });
  await historyEmptyContext.close();
  const { page: historyLoadingPage, context: historyLoadingContext } = await newPage({ width: 1440, height: 1000, theme: 'light', apiMode: 'history-loading' });
  const pendingHistoryRequests = Promise.all(['history.enabled', 'history.list'].map(operation => historyLoadingPage.waitForResponse(response => {
    const request = response.request();
    if (!new URL(response.url()).pathname.endsWith('/v1/requests') || request.method() !== 'POST') return false;
    try { return request.postDataJSON().operation === operation; } catch { return false; }
  })));
  await historyLoadingPage.goto(`${origin}/history`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await historyLoadingPage.locator('#main-content h1').waitFor({ state: 'visible' });
  await historyLoadingPage.waitForTimeout(150);
  await capture('history-request-pending', historyLoadingPage, { route: '/history', state: 'empty presentation while delayed history requests are pending (no visible loading indicator)', pendingApiOperations: ['history.enabled', 'history.list'] });
  await pendingHistoryRequests;
  await historyLoadingPage.getByText('No saved conversations yet.').waitFor({ state: 'visible' });
  await capture('history-request-settled', historyLoadingPage, { route: '/history', state: 'resolved empty history' });
  await historyLoadingContext.close();
  const { page: historyOpenPage, context: historyOpenContext } = await visit('history-record-open-initial', '/history', { width: 1440, height: 1000, theme: 'light' });
  await historyOpenPage.locator('li.row button.open').click();
  await historyOpenPage.getByRole('heading', { name: /What does the local library preserve/i }).waitFor();
  await capture('history-record-open', historyOpenPage, { route: '/history', state: 'saved answer opened' });
  await historyOpenPage.getByText(/QA Reference Guide · pages 2/i).click();
  await capture('history-source-expanded', historyOpenPage, { route: '/history', state: 'saved answer source detail' });
  await historyOpenContext.close();
  const { page: historyOpenDarkPage, context: historyOpenDarkContext } = await visit('history-record-open-dark-initial', '/history', { width: 1440, height: 1000, theme: 'dark' });
  await historyOpenDarkPage.locator('li.row button.open').click();
  await historyOpenDarkPage.getByRole('heading', { name: /What does the local library preserve/i }).waitFor();
  await capture('history-record-open-dark', historyOpenDarkPage, { route: '/history', state: 'saved answer opened' });
  await historyOpenDarkContext.close();
  const { page: historyOpenNarrowPage, context: historyOpenNarrowContext } = await visit('history-record-open-narrow-initial', '/history', { width: 390, height: 844, theme: 'light' });
  await historyOpenNarrowPage.locator('li.row button.open').click();
  await historyOpenNarrowPage.getByRole('heading', { name: /What does the local library preserve/i }).waitFor();
  await capture('history-record-open-narrow', historyOpenNarrowPage, { route: '/history', state: 'saved answer opened at narrow viewport' });
  await historyOpenNarrowContext.close();
  const { page: historyActionsPage, context: historyActionsContext } = await visit('history-delete-clear', '/history', { width: 1440, height: 1000, theme: 'dark' });
  await historyActionsPage.getByRole('button', { name: /Delete What does the local library preserve/i }).click();
  await capture('history-delete-outcome', historyActionsPage, { route: '/history', state: 'record deleted' });
  await historyActionsContext.close();
  const { page: historyClearPage, context: historyClearContext } = await visit('history-clear-confirmation', '/history', { width: 1440, height: 1000, theme: 'light' });
  historyClearPage.on('dialog', dialog => dialog.accept());
  await historyClearPage.getByRole('button', { name: /Clear all history/i }).click();
  await historyClearPage.getByText(/Saved history cleared/i).waitFor();
  await capture('history-clear-outcome', historyClearPage, { route: '/history', state: 'clear confirmed and completed' });
  await historyClearContext.close();
  const { page: historyFailurePage, context: historyFailureContext } = await visit('history-failure-initial', '/history', { width: 1440, height: 1000, theme: 'dark', apiMode: 'history-failure' });
  await historyFailurePage.getByRole('alert').waitFor({ state: 'visible' });
  await capture('history-failure', historyFailurePage, { route: '/history', state: 'history load failure' });
  await historyFailureContext.close();

  // Settings defaults, updates, degraded readiness, and error handling.
  const { page: settingsUpdatedPage, context: settingsUpdatedContext } = await visit('settings-updated-initial', '/settings', { width: 1440, height: 1000, theme: 'light' });
  const generalKnowledgeSwitch = settingsUpdatedPage.locator('label.setting').filter({ hasText: 'Include general model knowledge by default' }).getByRole('switch');
  const historyPersistenceSwitch = settingsUpdatedPage.locator('label.setting').filter({ hasText: 'Save new answers to local conversation history' }).getByRole('switch');
  await disablePreference(settingsUpdatedPage, generalKnowledgeSwitch);
  await settingsUpdatedPage.getByText(/General knowledge preference saved/i).waitFor();
  await capture('settings-updated', settingsUpdatedPage, { route: '/settings', state: 'updated preferences' });
  await disablePreference(settingsUpdatedPage, historyPersistenceSwitch);
  await settingsUpdatedPage.getByText(/New answers will not be saved/i).waitFor();
  await capture('settings-persistence-off', settingsUpdatedPage, { route: '/settings', state: 'persistence disabled' });
  await settingsUpdatedContext.close();
  const { page: settingsDarkUpdatedPage, context: settingsDarkUpdatedContext } = await visit('settings-updated-dark-initial', '/settings', { width: 1440, height: 1000, theme: 'dark' });
  const darkKnowledgeSwitch = settingsDarkUpdatedPage.locator('label.setting').filter({ hasText: 'Include general model knowledge by default' }).getByRole('switch');
  const darkHistorySwitch = settingsDarkUpdatedPage.locator('label.setting').filter({ hasText: 'Save new answers to local conversation history' }).getByRole('switch');
  await disablePreference(settingsDarkUpdatedPage, darkKnowledgeSwitch);
  await settingsDarkUpdatedPage.getByText(/General knowledge preference saved/i).waitFor();
  await capture('settings-updated-dark', settingsDarkUpdatedPage, { route: '/settings', state: 'updated preferences' });
  await disablePreference(settingsDarkUpdatedPage, darkHistorySwitch);
  await settingsDarkUpdatedPage.getByText(/New answers will not be saved/i).waitFor();
  await capture('settings-persistence-off-dark', settingsDarkUpdatedPage, { route: '/settings', state: 'persistence disabled' });
  await settingsDarkUpdatedContext.close();
  const { page: settingsDegradedPage, context: settingsDegradedContext } = await visit('settings-degraded-initial', '/settings', { width: 390, height: 844, theme: 'dark', apiMode: 'degraded' });
  await settingsDegradedPage.locator('.panel[aria-labelledby="readiness-title"] [role="status"]').filter({ hasText: /Needs attention/ }).waitFor({ state: 'visible' });
  await capture('settings-degraded', settingsDegradedPage, { route: '/settings', state: 'degraded local readiness' });
  await settingsDegradedContext.close();
  const { page: settingsFailurePage, context: settingsFailureContext } = await visit('settings-error-initial', '/settings', { width: 1440, height: 1000, theme: 'dark', apiMode: 'settings-failure' });
  await settingsFailurePage.getByRole('alert').waitFor({ state: 'visible' });
  await capture('settings-error', settingsFailurePage, { route: '/settings', state: 'settings service error' });
  await settingsFailureContext.close();
  for (const route of ['/library', '/history', '/settings', '/', '/c/baseline-session']) {
    const slug = route === '/' ? 'root' : route.slice(1).replaceAll('/', '-') || 'root';
    for (const theme of ['light', 'dark']) {
      const { page, context } = await visit(`${slug}-${theme}-1440`, route, { width: 1440, height: 1000, theme });
      if (route === '/history') {
        const historySwitch = page.locator('#main-content label.setting').getByRole('switch');
        await disablePreference(page, historySwitch);
        if (await historySwitch.isChecked()) throw new Error('History persistence switch remained enabled in the persistence-off state.');
        await capture(`history-persistence-off-${theme}`, page, { route, state: 'persistence off' });
      }
      await context.close();
    }
    if (['/history', '/settings'].includes(route)) {
      const { context } = await visit(`${slug}-light-390`, route, { width: 390, height: 844, theme: 'light' });
      await context.close();
    }
  }
  const summary = { baselineCommit: '4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b', browser: `Chromium ${version}`, browserExecutable: browserPath, fixedClock: '2026-10-20T12:00:00.000Z epoch plus monotonic test time', timezone: 'America/New_York', deviceScaleFactor: 1, reducedMotion: 'reduce', origin, fixtureApi: 'schema-valid local workflow responses; no host writes', repeatProof: cases.find(item => item.case === 'chat-empty-light-1440-repeat')?.screenshotSha256 ?? null, cases: cases.map(({ case: name, route, viewport, screenshotSha256, details }) => ({ name, route, viewport, screenshotSha256, details })), blockedRequests: blocked, browserErrors };
  await fs.writeFile(path.join(stagingRoot, 'capture-index.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ captured: cases.length, blockedRequests: blocked.length, browser: version }, null, 2));
} finally {
  await browser.close();
}
// Publish only a complete run, after every browser context is closed. Failed
// attempts retain temporary evidence and leave the existing reference intact.
const acceptedMarker = path.join(outputRoot, 'ACCEPTED.json');
try { await fs.access(acceptedMarker); throw new Error(`Refusing to replace accepted original captures at ${outputRoot}`); }
catch (error) { if (error.message.startsWith('Refusing to replace')) throw error; }
const oldEntries = await fs.readdir(outputRoot).catch(() => []);
if (oldEntries.length) {
  const allowed = new Set(['capture-index.json', 'screenshots', 'metadata']);
  const unexpected = oldEntries.filter(entry => !allowed.has(entry));
  if (!oldEntries.includes('capture-index.json') || unexpected.length) throw new Error(`Refusing to replace output directory with unexpected contents: ${oldEntries.join(', ')}`);
  await fs.rm(outputRoot, { recursive: true });
}
await fs.mkdir(outputRoot, { recursive: true });
await fs.cp(stagingRoot, outputRoot, { recursive: true });
console.log(`Capture artifacts published to ${outputRoot}`);
