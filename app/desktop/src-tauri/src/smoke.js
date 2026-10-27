(async () => {
  let passed = false;
  try {
    for (let i = 0; i < 300; i++) {
      if (document.querySelector('textarea, [contenteditable="true"]')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!document.querySelector('textarea, [contenteditable="true"]')) throw new Error('Chat did not render');
    const health = await (await fetch('http://127.0.0.1:8765/health')).json();
    if (health.api_version !== 'secure-qa-dev/1' || !health.ready) throw new Error('Host not ready');
    const response = await fetch('http://127.0.0.1:8765/v1/requests', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({request_id: 'desktop-smoke', operation: 'settings.get', payload: {}})
    });
    const body = await response.json();
    if (!response.ok || body.request_id !== 'desktop-smoke' || !body.result) throw new Error('Workflow failed');
    passed = true;
  } finally {
    await window.__TAURI_INTERNALS__.invoke('smoke_finished', {passed});
  }
})();
