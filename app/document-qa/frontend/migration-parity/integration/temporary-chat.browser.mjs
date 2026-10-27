// Production preview on 5177; isolated deterministic host/data on 8766.
// Never touches the user's 8765 host. Run against a disposable empty history.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [], outbound = [], asks = [], saves = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
 const url = new URL(route.request().url());
 if (url.origin === 'http://127.0.0.1:8765') {
  if (route.request().method() === 'POST') {
   const request = route.request().postDataJSON();
   if (request.operation === 'answering.ask') asks.push(request.payload);
   if (request.operation === 'history.save') saves.push(request.payload);
  }
  const response = await route.fetch({ url: route.request().url().replace(':8765', ':8766') });
  return route.fulfill({ response });
 }
 if (url.origin === 'http://127.0.0.1:5177') return route.continue();
 outbound.push(url.href); return route.abort();
});
async function history() {
 const response = await page.request.post('http://127.0.0.1:8766/v1/requests', {
  data: { request_id: 'privacy-history', operation: 'history.list', payload: {} }
 });
 assert.equal(response.status(), 200);
 return (await response.json()).result.conversations;
}
async function ask(question, count) {
 const input = page.getByLabel('Ask a question about your library…');
 await input.fill(question); await input.press('Enter');
 await page.waitForFunction(expected => document.querySelectorAll('.chat-assistant .renderer-answer').length === expected, count);
}
try {
 const before = await history();
 await page.goto('http://127.0.0.1:5177');
 await page.getByRole('link', { name: 'Start temporary chat' }).click();
 await page.getByRole('note').filter({ hasText: 'not saved; follow-up memory unavailable' }).waitFor();
 await page.getByText('Temporary Chat', { exact: true }).hover();
 await page.getByRole('tooltip').filter({ hasText: "This chat won't appear in history." }).waitFor();
 await ask('What is the annual occupational dose limit?', 1);
 await ask('And what about the public?', 2);
 assert.ok(asks.slice(0, 2).every(payload => !('conversation_id' in payload)));
 assert.deepEqual(await history(), before);
 assert.deepEqual(saves, []);
 await page.getByRole('link', { name: 'Start saved chat' }).click();
 assert.equal(await page.locator('.chat-assistant .renderer-answer').count(), 0);
 await page.goBack();
 await page.getByRole('link', { name: 'Start saved chat' }).waitFor();
 assert.equal(await page.locator('.chat-assistant .renderer-answer').count(), 0);
 await page.getByRole('link', { name: 'New Chat', exact: true }).click();
 await page.getByRole('link', { name: 'Start temporary chat' }).waitFor();
 await ask('What is the annual occupational dose limit?', 1);
 await ask('And what about the public?', 2);
 assert.ok(asks[2].conversation_id);
 assert.equal(asks[2].conversation_id, asks[3].conversation_id);
 assert.equal((await history()).length, before.length + 1);
 const saved = page.locator('.saved-chats a').first();
 await saved.waitFor(); await saved.click();
 await page.waitForFunction(() => document.querySelectorAll('.chat-assistant .renderer-answer').length === 2);
 await page.reload();
 await page.waitForFunction(() => document.querySelectorAll('.chat-assistant .renderer-answer').length === 2);
 await page.getByRole('link', { name: 'Start temporary chat' }).waitFor();
 assert.deepEqual(saves, []);
 assert.deepEqual(errors, []);
 assert.deepEqual(outbound, []);
 console.log('PASS: temporary questions never persist; saved follow-ups share a thread and survive reload; mode resets on New Chat/back; no page errors or external requests.');
} finally { await browser.close(); }
