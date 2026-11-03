// Usage: node dev/shot.cjs <url> <out.png> [actions-json]
const { chromium } = require('playwright');
(async () => {
  const [url, out, actsJson, vw, vh] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +(vw || 1440), height: +(vh || 900) }, deviceScaleFactor: +(process.env.DSF || 1) });
  await page.addInitScript(() => { try { localStorage.setItem('why-here:onboarded', '1'); } catch {} });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.app && window.app.snap, null, { timeout: 60000 });
  const acts = actsJson ? JSON.parse(actsJson) : [];
  for (const a of acts) {
    if (a.eval) { const r = await page.evaluate(a.eval); if (r !== undefined) console.log('eval:', JSON.stringify(r).slice(0, 2000)); }
    if (a.wait) await page.waitForTimeout(a.wait);
    if (a.waitFor) await page.waitForFunction(a.waitFor, null, { timeout: 180000 });
    if (a.click) await page.click(a.click);
    if (a.mouse) await page.mouse.click(a.mouse[0], a.mouse[1]);
    if (a.shot) await page.screenshot({ path: a.shot, ...(a.shot.endsWith('.jpg') ? { type: 'jpeg', quality: 82 } : {}) });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  console.log(logs.join('\n'));
  await browser.close();
})();
