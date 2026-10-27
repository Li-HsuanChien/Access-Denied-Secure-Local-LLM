// Routed browser safety/action checks for the native React Chat renderer.
// Run with the React loopback dev server active; every host request is intercepted.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
import {
  createFixtureState,
  health,
  respond,
} from "../../../../../migration-parity/fixtures/responses.mjs";
const origin = process.env.RENDERER_ORIGIN || "http://127.0.0.1:5176";
assert.equal(
  new URL(origin).hostname,
  "127.0.0.1",
  "Renderer QA must stay on loopback",
);
const out =
  process.env.RENDERER_OUTPUT_ROOT ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "react-renderer-evidence-")));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
  ],
});
const results = {
  browser: browser.version(),
  browserExecutable: chromium.executablePath(),
  cases: [],
};
async function pageFor(mode = "answer", content = null) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    timezoneId: "America/New_York",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript(
    ({ mode }) => {
      if (window.top !== window) return;
      localStorage.theme = "light";
      localStorage.sidebar = mode === "rich" ? "true" : "false";
      const NativeDate = Date;
      const epoch = NativeDate.parse("2026-10-20T12:00:00Z");
      const started = performance.now();
      window.Date = class extends NativeDate {
        constructor(...args) {
          super(
            ...(args.length ? args : [epoch + performance.now() - started]),
          );
        }
        static now() {
          return epoch + performance.now() - started;
        }
      };
      let n = 0;
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      });
    },
    { mode: content ? "rich" : mode },
  );
  const page = await context.newPage(),
    blocked = [],
    errors = [],
    requests = [];
  const state = createFixtureState();
  state.mode = mode;
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === "8765") {
      if (url.pathname === "/health")
        return route.fulfill({ json: health(mode) });
      if (url.pathname !== "/v1/requests") {
        blocked.push(url.href);
        return route.abort("blockedbyclient");
      }
      const request = route.request().postDataJSON();
      const response = await respond(state, request);
      if (content && request.operation === "answering.ask")
        response.body.result.documents[0].text = content;
      return route.fulfill({ status: response.status, json: response.body });
    }
    if (url.pathname.includes("renderer-canary")) {
      blocked.push(url.href);
      return route.abort("blockedbyclient");
    }
    if (url.origin === origin) return route.continue();
    blocked.push(url.href);
    return route.abort("blockedbyclient");
  });
  await page.goto(origin + "/qa", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByText("Summarize the key points", { exact: true }).click();
  await page.locator(".renderer-assistant .markdown-prose").waitFor();
  await page.waitForTimeout(1800);
  if (!(await page.locator(".renderer-assistant").count())) {
    console.log("Retry after development reload");
    await page.waitForLoadState("networkidle");
    await page.getByText("Summarize the key points", { exact: true }).click();
    await page.locator(".renderer-assistant .markdown-prose").waitFor();
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => document.fonts.ready);
  return { page, context, blocked, errors, requests, state };
}

try {
  const rich = await pageFor("rich");
  const { page } = rich;
  assert.equal(await page.locator("svg.marks").count(), 2);
  assert.equal(await page.locator(".katex").count(), 2);
  assert.equal(
    await page.getByRole("button", { name: "Run", exact: true }).count(),
    0,
  );
  const code = page.locator(".renderer-code").first();
  const editor = code.locator(".cm-content");
  await editor.fill('print("edited")');
  await code.getByRole("button", { name: "Copy", exact: true }).click();
  const copiedCode = await page.evaluate(() => navigator.clipboard.readText());
  await code.getByRole("button", { name: "Save", exact: true }).click();
  await code.getByRole("button", { name: "Saved", exact: true }).waitFor();
  const recordsAfterCodeSave = rich.state.records.length;
  await page
    .locator(".renderer-assistant-actions")
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  const wholeCopy = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole("button", { name: "Copy table" }).click();
  const tableCopy = await page.evaluate(() => navigator.clipboard.readText());
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export to CSV" }).click(),
  ]);
  await csv.saveAs(out + "/table.csv");
  const diagram = page.locator(".renderer-diagram").last();
  const pan = diagram.locator(".renderer-panzoom");
  await pan.scrollIntoViewIfNeeded();
  await pan.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: -100,
    clientX: 800,
    clientY: 400,
  });
  await page.waitForTimeout(200);
  const zoom = await pan.getAttribute("style");
  await diagram.getByRole("button", { name: "Reset view" }).click();
  await page.waitForFunction(
    (node) => node.style.transform === "matrix(1, 0, 0, 1, 0, 0)",
    await pan.elementHandle(),
  );
  const reset = await pan.getAttribute("style");
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    diagram.getByRole("button", { name: "Download as SVG" }).click(),
  ]);
  await svg.saveAs(out + "/diagram.svg");
  await page
    .locator(".renderer-assistant-actions")
    .getByRole("button", { name: "Regenerate" })
    .click();
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await page.getByRole("button", { name: "Previous message" }).waitFor();
  await page.getByRole("button", { name: "Previous message" }).click();
  const restoredEdit = await page
    .locator(".renderer-code")
    .first()
    .locator(".cm-content")
    .innerText();
  results.cases.push({
    name: "content-actions",
    copiedCode,
    wholeCopyHasEdit: wholeCopy.includes('print("edited")'),
    recordsAfterCodeSave,
    tableCopy,
    zoom,
    reset,
    restoredEdit,
    blocked: rich.blocked,
    errors: rich.errors,
  });
  await rich.context.close();
  const html =
    '```html\n<div><strong style="color:red">Inert local HTML preview</strong><script>parent.RENDERER_ATTACK=true</script><img src="http://127.0.0.1:8765/forbidden"><a href="https://evil.test" target="_top">Blocked navigation</a><iframe src="https://evil.test/frame"></iframe><form action="https://evil.test"><input autofocus></form><svg><image href="https://evil.test/a"/></svg></div>\n```\n';
  const preview = await pageFor("answer", html);
  await preview.page
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  const frame = preview.page.frameLocator('iframe[title="HTML preview"]');
  await frame.getByText("Inert local HTML preview", { exact: true }).waitFor();
  await frame.getByText("Blocked navigation").click();
  await preview.page.waitForTimeout(200);
  await preview.page.screenshot({ path: out + "/html-preview.png" });
  results.cases.push({
    name: "html-preview",
    sandbox: await preview.page.locator("iframe").getAttribute("sandbox"),
    srcdoc: await preview.page.locator("iframe").getAttribute("srcdoc"),
    frameText: await frame.locator("body").innerText(),
    url: preview.page.url(),
    scriptRan: await preview.page.evaluate(
      () => window.RENDERER_ATTACK ?? false,
    ),
    blocked: preview.blocked,
    errors: preview.errors,
    requests: preview.requests.filter(
      (url) => url.includes("forbidden") || url.includes("evil"),
    ),
  });
  await preview.context.close();
  const svgSource =
    '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><circle cx="30" cy="30" r="20" fill="green"/><script>window.RENDERER_ATTACK=true</script><image href="http://127.0.0.1:8765/forbidden"/><a href="https://evil.test"><text x="50" y="30">safe</text></a></svg>\n```\n';
  const escaped = String.raw`<defs><linearGradient id="paint"><stop offset="0" stop-color="green"/></linearGradient></defs><rect x="60" y="5" width="20" height="20" fill="url(#paint)"/><rect width="10" height="10" fill="u\72l(${origin}/renderer-canary.svg#paint)" filter="u\000072l(${origin}/renderer-canary-filter.svg#f)" stroke="url(\68ttp://evil.test/renderer-canary-stroke)" style="mask:u\72l(${origin}/renderer-canary-style.svg#m)"/>`;
  const svgPreview = await pageFor(
    "answer",
    svgSource.replace("</svg>", escaped + "</svg>"),
  );
  await svgPreview.page
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  const svgPan = svgPreview.page.locator(
    ".renderer-artifact .renderer-panzoom",
  );
  await svgPan.locator("circle").waitFor();
  await svgPan.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: -100,
    clientX: 1100,
    clientY: 400,
  });
  await svgPreview.page.waitForTimeout(200);
  const svgZoom = await svgPan.getAttribute("style");
  await svgPreview.page
    .locator(".renderer-artifact")
    .getByRole("button", { name: "Reset view" })
    .click();
  await svgPreview.page.waitForFunction(
    (node) => node.style.transform === "matrix(1, 0, 0, 1, 0, 0)",
    await svgPan.elementHandle(),
  );
  const svgReset = await svgPan.getAttribute("style");
  await svgPreview.page.screenshot({ path: out + "/svg-preview.png" });
  const [artifactDownload] = await Promise.all([
    svgPreview.page.waitForEvent("download"),
    svgPreview.page
      .locator(".renderer-artifact header")
      .getByRole("button", { name: "Download", exact: true })
      .click(),
  ]);
  await artifactDownload.saveAs(out + "/artifact.svg");
  const [previewDownload] = await Promise.all([
    svgPreview.page.waitForEvent("download"),
    svgPreview.page
      .locator(".renderer-artifact")
      .getByRole("button", { name: "Download as SVG", exact: true })
      .click(),
  ]);
  await previewDownload.saveAs(out + "/preview.svg");
  const exported = await Promise.all(
    ["artifact.svg", "preview.svg"].map((file) =>
      fs.readFile(out + "/" + file, "utf8"),
    ),
  );
  const mounted = await svgPan.innerHTML();
  for (const value of [mounted, ...exported]) {
    assert.doesNotMatch(
      value,
      /renderer-canary|evil\.test|u\\(?:72|000072)l|\\68ttp/,
    );
    assert.match(value, /url\((?:["']|&quot;)?#paint/);
  }
  results.cases.push({
    name: "svg-preview",
    exported,
    requests: svgPreview.requests.filter(
      (url) =>
        url.includes("renderer-canary") ||
        url.includes("forbidden") ||
        url.includes("evil.test"),
    ),
    iframeCount: await svgPreview.page
      .locator(".renderer-artifact iframe")
      .count(),
    content: await svgPan.innerHTML(),
    zoom: svgZoom,
    reset: svgReset,
    blocked: svgPreview.blocked,
    errors: svgPreview.errors,
  });
  await svgPreview.context.close();
  const hostile =
    '```vega-lite\n{"layer":[{"data":{"url":"http://127.0.0.1:8765/forbidden"},"mark":"bar"}]}\n```\n\n```vega\n{"width":100,"signals":[{"name":"attack","update":"fetch(\\"http://127.0.0.1:8765/forbidden\\")"}]}\n```\n\n```mermaid\n%%{init:{"securityLevel":"loose"}}%%\ngraph LR\nA-->B\n```\n';
  const unsafe = await pageFor("answer", hostile);
  results.cases.push({
    name: "unsafe-diagrams",
    alerts: await unsafe.page.getByRole("alert").allTextContents(),
    blocked: unsafe.blocked,
    errors: unsafe.errors,
    requests: unsafe.requests.filter((url) => url.includes("forbidden")),
  });
  await unsafe.context.close();
  for (const result of results.cases) {
    assert.deepEqual(result.blocked, [], `${result.name}: external request`);
    assert.deepEqual(result.errors, [], `${result.name}: page error`);
    if (result.requests)
      assert.deepEqual(
        result.requests,
        [],
        `${result.name}: model resource request`,
      );
  }
  const actions = results.cases[0];
  assert.equal(actions.copiedCode, 'print("edited")');
  assert.equal(actions.wholeCopyHasEdit, true);
  assert.equal(actions.recordsAfterCodeSave, 2);
  assert.equal(actions.restoredEdit, 'print("edited")');
  assert.match(actions.zoom, /matrix\(1\.2214,/);
  assert.match(actions.reset, /matrix\(1, 0, 0, 1, 0, 0\)/);
  assert.match(
    await fs.readFile(out + "/table.csv", "utf8"),
    /^\uFEFF"Factor","Value"\n"Alpha","12"/,
  );
  const htmlResult = results.cases[1];
  assert.equal(htmlResult.sandbox, "");
  assert.equal(htmlResult.scriptRan, false);
  assert.equal(htmlResult.url, origin + "/qa");
  assert.match(htmlResult.srcdoc, /default-src 'none'/);
  assert.doesNotMatch(
    htmlResult.srcdoc,
    /<script|evil\.test|forbidden|<iframe|<form/,
  );
  const svgResult = results.cases[2];
  assert.equal(svgResult.iframeCount, 0);
  assert.match(svgResult.zoom, /matrix\(1\.2214,/);
  assert.match(svgResult.reset, /matrix\(1, 0, 0, 1, 0, 0\)/);
  assert.doesNotMatch(
    svgResult.content,
    /<script|evil\.test|forbidden|foreignObject/,
  );
  assert.equal(results.cases[3].alerts.length, 3);
  console.log(`Renderer browser checks passed; evidence: ${out}`);
} finally {
  await fs.writeFile(out + "/actions.json", JSON.stringify(results, null, 2));
  await browser.close();
}
