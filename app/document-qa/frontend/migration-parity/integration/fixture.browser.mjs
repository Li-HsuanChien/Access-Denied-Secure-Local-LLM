import assert from 'node:assert/strict';
import { browser, mode, session, send, idle, navigate, committed, deferred, until, finish } from './runtime.mjs';
assert.equal(mode, 'fixture', 'Use host.browser.mjs for actual Python host coverage.');
const ok = (request, result) => ({ status: 200, body: { request_id: request.request_id, operation: request.operation, result } });

try {
  // Direct routes, document reload and actual History Back/Forward, including
  // unsupported upstream conversation URLs and same-root New Chat.
  {
    const s = await session({ name: 'direct routes, reload, Back/Forward and New Chat' }), p = s.page;
    for (const route of ['/', '/qa', '/library', '/history', '/settings', '/c/old-thread', '/unknown']) {
      await p.goto(new URL(route, p.url()).href);
      if (['/c/old-thread', '/unknown'].includes(route)) await p.waitForURL('**/');
      assert.equal(new URL(p.url()).pathname, ['/c/old-thread', '/unknown'].includes(route) ? '/' : route);
      await p.getByRole('main').waitFor();
    }
    await p.locator('#chat-input').fill('Draft lost on reload'); await p.reload();
    await p.locator('#chat-input').waitFor(); assert.equal(await p.locator('#chat-input').innerText(), '');
    await p.locator('#chat-input').fill('Same-root draft'); await navigate(p, 'New Chat');
    assert.equal(await p.locator('#chat-input').innerText(), '');
    await navigate(p, 'History'); await p.getByRole('heading', { name: 'History', exact: true }).waitFor();
    await p.goBack(); await p.locator('#chat-input').waitFor();
    await p.goForward(); await p.getByRole('heading', { name: 'History', exact: true }).waitFor();
    assert.equal(s.operations('answering.ask').length, 0); await s.close();
  }
  {
    const s = await session({ name: 'keyboard, suggestion, copy/edit, branch, regenerate, delete and sources' }), p = s.page;
    await p.locator('#chat-input').pressSequentially('First line'); await p.locator('#chat-input').press('Shift+Enter'); await p.locator('#chat-input').pressSequentially('Second line');
    assert.equal(await p.locator('#chat-input').innerText(), 'First line\nSecond line');
    await p.locator('#chat-input').evaluate(node => { node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    assert.equal(s.operations('answering.ask').length, 0, 'IME Enter must not submit');
    await navigate(p, 'New Chat'); await p.locator('button').filter({ hasText: 'Summarize the key points' }).click();
    await p.getByText('From your documents', { exact: true }).waitFor(); await idle(p);
    assert.equal(s.operations('history.save').length, 1);
    await p.getByRole('button', { name: 'Toggle 1 source', exact: true }).click();
    const source = p.getByRole('button', { name: /^View source:/ }); await source.click();
    await p.getByRole('dialog').waitFor(); await p.keyboard.press('Tab');
    assert(await p.getByRole('dialog').evaluate(node => node.contains(document.activeElement)), 'modal traps focus');
    await p.keyboard.press('Escape'); await p.getByRole('dialog').waitFor({ state: 'detached' });
    assert(await source.evaluate(node => document.activeElement === node), 'source focus restored');
    await source.click(); await p.getByRole('button', { name: 'Close citation modal' }).click();
    await p.locator('.user-message').hover(); await p.locator('.user-message').getByRole('button', { name: 'Copy', exact: true }).click();
    assert((await p.evaluate(() => navigator.clipboard.readText())).includes('Summarize the key points'));
    await p.locator('.user-message').getByRole('button', { name: 'Edit', exact: true }).click();
    await p.getByRole('textbox', { name: 'Edit message' }).fill('User edited presentation'); await p.locator('#save-edit-message-button').click();
    assert.equal(s.operations('answering.ask').length, 1, 'User Save is presentation only');
    await p.getByRole('button', { name: 'Chat actions', exact: true }).click(); await p.locator('#chat-copy-button').click();
    assert((await p.evaluate(() => navigator.clipboard.readText())).includes('### USER\nUser edited presentation\n\n### ASSISTANT'));
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Edit', exact: true }).click();
    await p.getByRole('textbox', { name: 'Edit message' }).fill('Assistant edited presentation'); await p.locator('#save-new-message-button').click();
    assert.equal(s.operations('history.save').length, 1, 'Save As Copy must not persist');
    assert(!s.state.records[0].answer.documents[0].text.includes('Assistant edited presentation'), 'original answer is immutable');
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Previous message', exact: true }).click();
    await p.getByText('From your documents', { exact: true }).waitFor();
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Regenerate', exact: true }).click(); await p.getByRole('button', { name: 'Add Details', exact: true }).click();
    await idle(p); assert.equal(s.operations('answering.ask').length, 2);
    assert.deepEqual(s.operations('answering.ask')[1].payload, { question: 'User edited presentation', general_knowledge: true });
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Delete', exact: true }).click(); await p.getByRole('button', { name: 'Cancel', exact: true }).click();
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Delete', exact: true }).click(); await p.getByRole('button', { name: 'Confirm', exact: true }).click();
    assert.equal(s.operations('history.save').length, 2); await s.close();
  }
  {
    const gate = deferred();
    const s = await session({ name: 'rapid Enter/click, queue Edit/Delete/FIFO and dispatch preference', handle: async (request, forward) => { if (request?.operation === 'answering.ask' && request.payload.question === 'first') await gate.promise; return forward(); } }), p = s.page;
    await p.locator('#chat-input').fill('first');
    await p.locator('#chat-input').evaluate(node => { const send = document.querySelector('#send-message-button'); node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); send?.click(); });
    await until(() => s.operations('answering.ask').length === 1); assert.equal(await p.locator('.chat-queue').count(), 0, 'same-tick Enter/click is not duplicated');
    await send(p, 'edit queued'); await p.locator('.chat-queue').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await p.locator('#chat-input').innerText(), 'edit queued'); await p.locator('#chat-input').press('Enter');
    await p.locator('.chat-queue').getByRole('button', { name: 'Delete', exact: true }).click();
    await send(p, 'second'); await send(p, 'third');
    await committed(p.locator('.service-status').getByRole('switch'), false); assert.equal(s.operations('answering.ask').length, 1);
    gate.resolve(); await idle(p);
    const asks = s.operations('answering.ask'), saves = s.operations('history.save');
    assert.deepEqual(asks.map(request => request.payload.question), ['first', 'second', 'third']);
    assert.deepEqual(asks.map(request => request.payload.general_knowledge), [true, false, false]);
    assert.equal(saves.length, 3);
    for (let index = 1; index < asks.length; index++) assert(asks[index].start >= saves[index - 1].end, 'queue waits for answer and history settlement');
    await s.close();
  }
  {
    const gate = deferred();
    const s = await session({ name: 'pending answer across route and New Chat, discarded queue and late completion', handle: async (request, forward) => { if (request?.operation === 'answering.ask' && request.payload.question === 'old session') await gate.promise; return forward(); } }), p = s.page;
    await send(p, 'old session'); await send(p, 'discard unsent'); await navigate(p, 'History');
    await p.getByRole('heading', { name: 'History', exact: true }).waitFor(); await navigate(p, 'New Chat'); await send(p, 'new session queued');
    assert.equal(s.operations('answering.ask').length, 1); gate.resolve(); await idle(p);
    assert.deepEqual(s.operations('answering.ask').map(request => request.payload.question), ['old session', 'new session queued']);
    assert.equal(s.operations('history.save').length, 2); assert(!(await p.locator('#messages-container').innerText()).includes('old session'));
    await s.close();
  }
  {
    const s = await session({ name: 'history-save failure keeps answer and releases lock', fixtureMode: 'history-save-failure' }), p = s.page;
    await send(p, 'answer retained'); await p.getByText(/This answer is available here, but could not be saved/).first().waitFor(); await idle(p);
    await send(p, 'next answer'); await idle(p);
    assert.equal(s.operations('answering.ask').length, 2); assert.equal(s.operations('history.save').length, 2);
    assert.equal(await p.locator('.renderer-assistant').count(), 2); await s.close();
  }
  {
    const write = deferred(); let rejectWrite = false;
    const s = await session({ name: 'Header/Settings/History committed preferences and failed writes', routePath: '/settings', handle: async (request, forward) => {
      if (request?.operation === 'settings.update') { await write.promise; if (rejectWrite) return { status: 503, body: { request_id: request.request_id, error: { code: 'settings_unavailable', message: 'Local settings are unavailable.', hint: 'Try again later.' } } }; }
      return forward();
    } }), p = s.page;
    const header = p.locator('.service-status').getByRole('switch'), settings = p.locator('label.setting').filter({ hasText: 'Include general model knowledge by default' }).getByRole('switch');
    await settings.click(); await until(() => s.operations('settings.update').length === 1);
    assert(await header.isChecked()); assert(await settings.isChecked(), 'value waits for committed host response');
    write.resolve(); await p.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].slice(0, 2).every(node => !node.checked));
    rejectWrite = true; await settings.click(); await p.getByRole('alert').waitFor();
    assert.equal(await header.isChecked(), false); assert.equal(await settings.isChecked(), false);
    const persistence = p.locator('label.setting').filter({ hasText: 'Save new answers to local conversation history' }).getByRole('switch');
    await committed(persistence, false); await navigate(p, 'History');
    await p.getByRole('heading', { name: 'History', exact: true }).waitFor(); assert.equal(await p.locator('main').getByRole('switch').isChecked(), false);
    await navigate(p, 'New Chat'); await send(p, 'unsaved answer'); await idle(p);
    assert.equal(s.operations('history.save').at(-1).result.result.saved, false);
    assert.equal(s.operations('answering.ask').at(-1).payload.general_knowledge, false); await s.close();
  }
  {
    const opened = deferred(), staleList = deferred(); let delayList = false;
    const s = await session({ name: 'saved metadata/native sources, stale open/list after clear and delete', routePath: '/history', handle: async (request, forward) => {
      if (request?.operation === 'history.open') { const snapshot = await forward(); await opened.promise; return snapshot; }
      if (request?.operation === 'history.list' && delayList) { delayList = false; const snapshot = await forward(); await staleList.promise; return snapshot; }
      return forward();
    } }), p = s.page;
    await p.locator('li.row button.open').waitFor(); await p.locator('li.row button.open').click();
    p.once('dialog', dialog => dialog.accept()); await p.getByRole('button', { name: 'Clear all history', exact: true }).click();
    await p.getByText('Saved history cleared.', { exact: true }).waitFor(); opened.resolve(); await until(() => s.operations('history.open')[0].end !== null);
    assert.equal(await p.locator('#opened-title').count(), 0); assert.equal(await p.locator('li.row').count(), 0);
    s.state.records = [{ ...s.state.records[0], conversation_id: 'second', title: 'Second record', updated_at: '2026-10-20', model_id: 'fixture-model', collection_version: 'fixture-v1', answer: (await import('../fixtures/responses.mjs')).answerFor({ request_id: 'saved', payload: { question: 'Second record', general_knowledge: true } }) }];
    await p.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click(); await p.locator('li.row button.open').waitFor();
    await p.locator('li.row button.open').click(); await p.getByRole('heading', { name: 'Second record', exact: true }).waitFor();
    assert((await p.locator('[aria-labelledby=opened-title]').innerText()).includes('Model fixture-model · Collection fixture-v1'));
    await p.locator('details summary').click(); assert(await p.locator('details').evaluate(node => node.open)); assert.equal(await p.locator('.renderer-assistant').count(), 0);
    delayList = true; await p.locator('main').getByRole('button', { name: 'Refresh', exact: true }).click();
    await p.getByRole('button', { name: 'Delete Second record', exact: true }).click(); await p.getByText('Conversation deleted.', { exact: true }).waitFor();
    staleList.resolve(); await until(() => s.operations('history.list').every(request => request.end !== null));
    assert.equal(await p.locator('li.row').count(), 0); assert.equal(await p.locator('#opened-title').count(), 0); await s.close();
  }
  {
    const publication = deferred(); let releases = 0;
    const s = await session({ name: 'Library confirmation/publication identity across navigation, cancellation and restart', routePath: '/library', handle: async (request, forward, state) => {
      if (request?.operation === 'library.publish') { state.publishStarted = true; if (++releases === 1) await publication.promise; else state.cancelled = false; }
      return forward();
    } }), p = s.page;
    await p.locator('#pdfs').setInputFiles([{ name: 'accepted-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-local') }, { name: 'rejected-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('bad') }]);
    await p.getByRole('button', { name: 'Review selected files', exact: true }).click(); await p.getByRole('heading', { name: 'Review import' }).waitFor();
    const publish = p.getByRole('button', { name: 'Publish accepted PDFs', exact: true }); assert(await publish.isDisabled());
    await p.locator('label.check input').check(); await publish.click(); await p.getByRole('heading', { name: 'Publication in progress' }).waitFor();
    const id = s.operations('library.publish')[0].request_id;
    await navigate(p, 'Settings'); await p.getByRole('heading', { name: 'Settings', exact: true }).waitFor(); await navigate(p, 'Library');
    await p.getByRole('heading', { name: 'Publication in progress' }).waitFor(); assert(await p.getByRole('button', { name: 'Restart publication' }).isDisabled());
    await until(() => s.operations('library.status').length > 0); await p.getByRole('button', { name: 'Cancel publication', exact: true }).click();
    await p.getByText(/Cancelling safely/).waitFor(); assert.equal(s.operations('library.cancel')[0].payload.target_request_id, id);
    assert(s.operations('library.status').every(request => request.payload.target_request_id === id));
    assert.equal(await p.getByRole('heading', { name: 'Publication in progress' }).count(), 1, 'cancel acknowledgement is not completion');
    publication.resolve(); await p.getByRole('alert').waitFor(); await p.getByRole('heading', { name: 'Publication in progress' }).waitFor({ state: 'detached' });
    await p.getByRole('button', { name: 'Restart publication' }).click(); await p.getByText(/Collection fixture-v2 is active/).waitFor();
    assert.equal(s.operations('library.publish').length, 2); assert.notEqual(s.operations('library.publish')[1].request_id, id);
    await p.getByRole('button', { name: /Roll back/ }).click(); await p.getByText(/is active again/).waitFor(); await s.close();
  }
  {
    const terminal = deferred(); let polls = 0;
    const s = await session({ name: 'lost publication POST retains ownership through null/error status until terminal', routePath: '/library', handle: async (request, forward) => {
      if (request?.operation === 'library.publish') return { status: 200, body: { request_id: request.request_id, operation: 'wrong-operation', result: {} } };
      if (request?.operation === 'library.status') {
        polls++;
        if (polls === 1) return ok(request, null);
        if (polls === 2) return { status: 503, body: { request_id: request.request_id, error: { code: 'unreachable', message: 'Status unavailable', hint: '' } } };
        await terminal.promise; return ok(request, { status: 'cancelled', stage: 'extracting', done: 0, total: 1 });
      }
      return forward();
    } }), p = s.page;
    await p.locator('#pdfs').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    await p.getByRole('button', { name: 'Review selected files', exact: true }).click(); await p.locator('label.check input').check();
    await p.getByRole('button', { name: 'Publish accepted PDFs' }).click(); await p.getByRole('alert').waitFor();
    await until(() => polls >= 3); assert.equal(await p.getByRole('heading', { name: 'Publication in progress' }).count(), 1);
    await navigate(p, 'History'); await navigate(p, 'Library'); assert.equal(await p.getByRole('heading', { name: 'Publication in progress' }).count(), 1);
    terminal.resolve(); await p.getByRole('heading', { name: 'Publication in progress' }).waitFor({ state: 'detached' });
    assert(await p.getByRole('button', { name: 'Restart publication' }).isEnabled()); await s.close();
  }
  {
    const s = await session({ name: 'model/status menus, long scrolling and code Save preserves original persisted answer', fixtureMode: 'long' }), p = s.page;
    await p.getByRole('button', { name: 'Selected model: Document Assistant' }).click();
    await p.getByRole('button', { name: 'Set as default', exact: true }).click();
    assert.equal(await p.getByRole('listbox', { name: 'Available models' }).count(), 1);
    await p.getByRole('button', { name: 'Compare', exact: true }).click(); assert.equal(await p.getByRole('button', { name: 'Compare', exact: true }).getAttribute('aria-pressed'), 'true');
    await p.getByRole('textbox', { name: 'Search In Models' }).fill('nonexistent'); await p.getByText('No results found', { exact: true }).waitFor();
    await p.getByRole('textbox', { name: 'Search In Models' }).press('Escape');
    await send(p, '/status'); await p.getByText('Context usage', { exact: true }).waitFor();
    await p.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(s.operations('answering.ask').length, 0);
    await send(p, 'long response with code'); await idle(p);
    const stored = structuredClone(s.state.records[0].answer), code = p.locator('.renderer-code').first();
    await code.locator('.cm-content').fill('print("stage4a local edit")'); await code.getByRole('button', { name: 'Save', exact: true }).click();
    await code.getByRole('button', { name: 'Saved', exact: true }).waitFor();
    await p.locator('.renderer-assistant-actions').getByRole('button', { name: 'Copy', exact: true }).click();
    assert((await p.evaluate(() => navigator.clipboard.readText())).includes('print("stage4a local edit")'));
    assert.deepEqual(s.state.records[0].answer, stored); assert.equal(s.operations('history.save').length, 1);
    await p.locator('#messages-container').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
    await p.getByRole('button', { name: 'Scroll to bottom', exact: true }).click();
    await p.waitForFunction(() => { const node = document.querySelector('#messages-container'); return node.scrollTop + node.clientHeight >= node.scrollHeight - 5; });
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Regenerate', exact: true }).click(); await p.getByRole('button', { name: 'Try Again', exact: true }).click();
    await idle(p); await p.locator('.renderer-assistant').getByRole('button', { name: 'Previous message', exact: true }).click();
    assert.equal(await p.locator('.renderer-code').first().locator('.cm-content').innerText(), 'print("stage4a local edit")');
    assert.deepEqual(s.state.records.find(record => record.answer.request_id === stored.request_id).answer, stored); await s.close();
  }
  {
    const regenerated = deferred(); let asks = 0;
    const s = await session({ name: 'regeneration holds shared lock and a pending sibling exposes no overlapping regenerate', handle: async (request, forward) => { if (request?.operation === 'answering.ask' && ++asks === 2) await regenerated.promise; return forward(); } }), p = s.page;
    await send(p, 'original selected question'); await idle(p);
    await p.locator('.renderer-assistant').getByRole('button', { name: 'Regenerate', exact: true }).click(); await p.getByRole('button', { name: 'More Concise', exact: true }).click();
    await until(() => s.operations('answering.ask').length === 2); assert.equal(await p.getByRole('button', { name: 'Regenerate', exact: true }).count(), 0);
    await send(p, 'queued during regeneration'); assert.equal(s.operations('answering.ask').length, 2);
    regenerated.resolve(); await idle(p);
    assert.deepEqual(s.operations('answering.ask').map(request => request.payload.question), ['original selected question', 'original selected question', 'queued during regeneration']);
    assert.equal(s.operations('history.save').length, 3); await s.close();
  }
  await finish();
} finally { await browser.close(); }
