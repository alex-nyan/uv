// Probes the LIVE uv docs homepage: measures real CLS and reports the benchmark
// image's computed CSS (do we already get height:auto / max-width:100% from Material?).
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.addInitScript(() => {
  window.__cls = 0;
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.hadRecentInput) {
        window.__cls += e.value;
        window.__shifts.push({
          value: Number(e.value.toFixed(5)),
          sources: (e.sources || []).map((s) => (s.node ? s.node.nodeName + (s.node.getAttribute ? "[" + (s.node.getAttribute("alt") || "") + "]" : "") : "?")),
        });
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
});

// Throttle network so the image arrives after first paint (mimics a cold visit).
const client = await context.newCDPSession(page);
await client.send("Network.enable");
await client.send("Network.emulateNetworkConditions", {
  offline: false,
  downloadThroughput: (400 * 1024) / 8, // ~400kbps "Slow 3G"-ish
  uploadThroughput: (400 * 1024) / 8,
  latency: 400,
});
await client.send("Network.setCacheDisabled", { cacheDisabled: true });

await page.goto("https://docs.astral.sh/uv/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);

const cls = await page.evaluate(() => window.__cls);
const shifts = await page.evaluate(() => window.__shifts);

const imgInfo = await page
  .$eval('img[src*="#only-light"], img[alt="Shows a bar chart with benchmark results."]', (el) => {
    const cs = getComputedStyle(el);
    return {
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      attrWidth: el.getAttribute("width"),
      attrHeight: el.getAttribute("height"),
      cssMaxWidth: cs.maxWidth,
      cssWidth: cs.width,
      cssHeight: cs.height,
      cssAspectRatio: cs.aspectRatio,
      renderedW: Math.round(el.getBoundingClientRect().width),
      renderedH: Math.round(el.getBoundingClientRect().height),
    };
  })
  .catch((e) => ({ error: String(e) }));

await browser.close();
console.log(JSON.stringify({ liveCLS: Number(cls.toFixed(4)), shiftEvents: shifts.length, shifts, benchmarkImg: imgInfo }, null, 2));
