// Run with the production preview on 5177 and a disposable fake host on 8766.
// Intercept only the production loopback endpoint; never access the user's host.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const outbound = [];
await page.route('**/*', async route => {
 const url = new URL(route.request().url());
 if (url.origin === 'http://127.0.0.1:8765') {
  const response = await route.fetch({ url: route.request().url().replace(':8765', ':8766') });
  return route.fulfill({ response });
 }
 if (url.origin === 'http://127.0.0.1:5177') return route.continue();
 outbound.push(url.href); return route.abort();
});
try {
 await page.goto('http://127.0.0.1:5177');
 await page.getByLabel('Ask a question about your library…').fill('What is the annual occupational dose limit?');
 await page.getByLabel('Ask a question about your library…').press('Enter');
 await page.getByRole('button', { name: 'View citation 1', exact: true }).waitFor();
 await page.getByRole('button', { name: 'View citation 1', exact: true }).click();
 await page.locator('.pdf-page canvas').waitFor();
 await page.waitForFunction(() => document.querySelectorAll('.textLayer span').length > 0);
 const canvas = page.locator('.pdf-page canvas');
 assert.ok(await canvas.evaluate(node => node.width > 0 && node.height > 0));
 await page.getByRole('button', { name: 'Next page', exact: true }).click();
 await page.waitForFunction(() => document.querySelector('input[aria-label="PDF page"]')?.value === '2');
 await page.getByRole('button', { name: 'Close citation modal' }).click();
 await page.getByLabel('Ask a question about your library…').fill('And what about the public?');
 await page.getByLabel('Ask a question about your library…').press('Enter');
 await page.waitForFunction(() => document.querySelectorAll('.renderer-answer').length === 2);
 const savedLink = page.locator('.saved-chats a').first();
 await savedLink.waitFor();
 const roomPath = await savedLink.getAttribute('href');
 await savedLink.click();
 await page.waitForFunction(() => document.querySelectorAll('.renderer-answer').length === 2);
 await page.reload();
 await page.waitForFunction(() => document.querySelectorAll('.renderer-answer').length === 2);
 assert.equal(new URL(page.url()).pathname, roomPath);
 await page.getByRole('link', { name: 'Library', exact: true }).click();
 await page.getByRole('heading', { name: 'Knowledge Collections' }).waitFor();
 await page.locator('.document-title').first().click();
 await page.locator('.pdf-page canvas').waitFor();
 await page.getByRole('button', { name: 'Close preview' }).click();
 const usePdf = page.getByRole('switch', { name: /^Use .* in answers$/ }).first();
 await usePdf.uncheck();
 await page.getByText('PDF is off for future answers. Preview remains available.').waitFor();
 assert.equal(await usePdf.isChecked(), false);
 await page.getByRole('button', { name: /^Delete / }).first().click();
 await page.getByRole('dialog', { name: 'Delete PDF?' }).waitFor();
 await page.getByRole('button', { name: 'Cancel', exact: true }).click();
 assert.equal(await page.getByRole('dialog').count(), 0);
 assert.deepEqual(outbound, []);
 assert.deepEqual(errors, []);
 console.log('PASS: citations/PDF canvas + text, page navigation, threaded follow-up, saved-chat reload, Library preview/off/cancel-delete; no external requests or page errors.');
} finally { await browser.close(); }
