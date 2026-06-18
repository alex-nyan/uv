// Measures Cumulative Layout Shift (CLS) for the uv docs homepage markup.
// Reproduces astral-sh/uv#6264: the benchmark <img> reserves no height, so when it
// finishes loading the content below it jumps down (layout reflow / CLS).
//
// Usage: node measure-cls.mjs
// Requires: a local Google Chrome (Playwright launched with channel: "chrome").
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DELAY_MS = 1200; // simulate the image arriving after first paint
const SETTLE_MS = 2500;

async function measure(browser, label, file, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  // Start the Layout Instability observer before any navigation.
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__cls += e.value;
          window.__shifts.push(Number(e.value.toFixed(5)));
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  // Delay the benchmark image so the shift happens after first paint (mirrors real network).
  await page.route("**/benchmark.svg", async (route) => {
    await new Promise((r) => setTimeout(r, IMAGE_DELAY_MS));
    await route.continue();
  });

  // Raw CDP screenshot — unlike page.screenshot(), it does NOT wait for in-flight
  // images to finish loading, so it can capture the genuine pre-load (empty) state.
  const client = await context.newCDPSession(page);
  const rawShot = async (out) => {
    const { data } = await client.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(dir, out), Buffer.from(data, "base64"));
  };

  const url = pathToFileURL(path.join(dir, file)).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const tag = `${viewport.label}-${label}`;
  // "Before": image bytes not yet delivered (route is still holding the response).
  const beforeImg = await page.$eval("img.benchmark", (el) => el.getBoundingClientRect().height).catch(() => 0);
  await rawShot(`screenshot-${tag}-before.png`);

  await page.waitForTimeout(SETTLE_MS);

  // "After": image has loaded.
  const afterImg = await page.$eval("img.benchmark", (el) => el.getBoundingClientRect().height);
  await rawShot(`screenshot-${tag}-after.png`);

  const cls = await page.evaluate(() => window.__cls);
  const shifts = await page.evaluate(() => window.__shifts);

  await context.close();
  return {
    label,
    file,
    imageHeightBeforeLoad: Math.round(beforeImg),
    imageHeightAfterLoad: Math.round(afterImg),
    layoutShiftEvents: shifts.length,
    cls: Number(cls.toFixed(4)),
  };
}

const VIEWPORTS = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 }, // iPhone-class viewport
];

const browser = await chromium.launch({ channel: "chrome" });
const byViewport = {};
for (const vp of VIEWPORTS) {
  const buggy = await measure(browser, "buggy", "homepage-repro.html", vp);
  const fixed = await measure(browser, "fixed", "homepage-fixed.html", vp);
  byViewport[vp.label] = { viewport: { width: vp.width, height: vp.height }, buggy, fixed };
}
await browser.close();

// The bug is reproduced when the buggy page records a real layout shift that the fix eliminates.
const reproduced = Object.values(byViewport).every(
  (r) => r.buggy.cls > 0 && r.buggy.layoutShiftEvents > 0 && r.fixed.cls === 0 && r.fixed.layoutShiftEvents === 0,
);

const report = {
  issue: "astral-sh/uv#6264 — Fix reflow of index on image load",
  measuredAt_note: "CLS measured via the W3C Layout Instability API (the same metric Chrome DevTools / Lighthouse report).",
  conditions: { simulatedImageDelayMs: IMAGE_DELAY_MS, note: "Google Lighthouse rates CLS > 0.1 as 'needs improvement' and > 0.25 as 'poor'." },
  resultsByViewport: byViewport,
  verdict: reproduced
    ? "REPRODUCED: the dimensionless image shifts content downward on load (CLS > 0); reserving the aspect ratio removes the shift entirely (CLS = 0)."
    : "Inconclusive — inspect results.",
};

fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
