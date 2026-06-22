// Decide the fix: on the LIVE docs at a narrow viewport, inject width/height attrs
// onto the benchmark img and see whether it stays proportional (Material height:auto?)
// vs. distorts (would then need an explicit CSS height:auto / aspect-ratio).
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
const page = await context.newPage();
await page.goto("https://docs.astral.sh/uv/", { waitUntil: "load", timeout: 60000 });

const sel = 'img[alt="Shows a bar chart with benchmark results."]';

const before = await page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width / r.height).toFixed(3) };
});

// Apply the candidate fix: width/height attributes only (no CSS change).
await page.$eval(sel, (el) => {
  el.setAttribute("width", "496");
  el.setAttribute("height", "107");
});
await page.waitForTimeout(200);

const afterAttrsOnly = await page.$eval(sel, (el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    ratio: +(r.width / r.height).toFixed(3),
    cssHeight: cs.height,
  };
});

const naturalRatio = +(496 / 107).toFixed(3); // 4.636
await browser.close();
console.log(
  JSON.stringify(
    {
      naturalRatio,
      before,
      afterAttrsOnly,
      attrsOnlyDistorts: Math.abs(afterAttrsOnly.ratio - naturalRatio) > 0.1,
      conclusion:
        Math.abs(afterAttrsOnly.ratio - naturalRatio) > 0.1
          ? "width/height attributes ALONE distort on narrow screens -> also need CSS height:auto / aspect-ratio"
          : "width/height attributes alone stay proportional -> Material already applies height:auto; attribute-only fix is safe",
    },
    null,
    2,
  ),
);
