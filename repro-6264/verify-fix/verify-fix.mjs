// Validates the SHIPPED Phase III fix (width/height attributes on the benchmark <img>)
// against the current markup, using the real 496x107 dimensions and Material's
// content-image CSS (max-width:100%; height:auto). Measures CLS via the Layout
// Instability API and checks the image is not distorted at mobile width.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DELAY_MS = 1200;
const SETTLE_MS = 2500;
const NATURAL_RATIO = +(496 / 107).toFixed(3);

async function measure(browser, file, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__n = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__n++; }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.route("**/benchmark-496x107.svg", async (r) => { await new Promise((x) => setTimeout(x, IMAGE_DELAY_MS)); await r.continue(); });
  await page.goto(pathToFileURL(path.join(dir, file)).href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(SETTLE_MS);
  const box = await page.$eval("img", (el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  const cls = await page.evaluate(() => window.__cls);
  const n = await page.evaluate(() => window.__n);
  await context.close();
  return { cls: Number(cls.toFixed(4)), shiftEvents: n, renderedRatio: +(box.w / box.h).toFixed(3) };
}

const VIEWPORTS = [{ label: "desktop", width: 1280, height: 800 }, { label: "mobile", width: 390, height: 844 }];
const browser = await chromium.launch({ channel: "chrome" });
const out = {};
for (const vp of VIEWPORTS) {
  out[vp.label] = {
    current_bug: await measure(browser, "index-current.html", vp),
    fixed: await measure(browser, "index-attrfix.html", vp),
  };
}
await browser.close();

const allFixedZero = Object.values(out).every((r) => r.fixed.cls === 0 && r.fixed.shiftEvents === 0);
const noDistortion = Object.values(out).every((r) => Math.abs(r.fixed.renderedRatio - NATURAL_RATIO) < 0.05);
const bugReproduced = Object.values(out).every((r) => r.current_bug.cls > 0 && r.current_bug.shiftEvents > 0);

console.log(JSON.stringify({
  naturalRatio: NATURAL_RATIO,
  resultsByViewport: out,
  verdict: bugReproduced && allFixedZero && noDistortion
    ? "PASS: fix eliminates the layout shift (CLS -> 0, 0 shift events) and keeps the image proportional at every viewport."
    : "FAIL: inspect results.",
}, null, 2));
