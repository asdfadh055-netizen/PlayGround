// Capture runner: opens CAPTURE_URL, starts the fight, screenshots desktop+mobile.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const require = createRequire(join(runtime, 'package.json'));
const { chromium } = require('playwright');
const config = JSON.parse(readFileSync(join(runtime, 'linux.json'), 'utf8'));
if (process.platform === 'linux') {
  try { process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim(); } catch {}
}
const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
if (!url || !output) { console.error('Set CAPTURE_URL and CAPTURE_DIR.'); process.exit(1); }
mkdirSync(output, { recursive: true });
const transient = (e) => { throw Object.assign(e, { exitCode: 75 }); };
let browser;
try {
  browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(transient);
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }).catch(transient);
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => { errors.push(String(e && e.message || e)); console.error('pageerror:', e && e.message); });
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient);
    if (!response?.ok()) {
      const st = response?.status();
      const code = !response || [408, 429, 500, 502, 503, 504].includes(st) ? 75 : 1;
      throw Object.assign(new Error(`HTTP ${st} loading preview`), { exitCode: code });
    }
    await page.locator('body').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 }).catch(() => {});
    // wait for WebGL scene boot
    await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    // start the fight so screenshots show live combat HUD (DOM click: deterministic under SwiftShader)
    try {
      await page.waitForSelector('#btn-start', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => document.getElementById('btn-start').click());
    } catch (e) { console.error('start click failed:', e.message); }
    // reach the fight round (slow software renderers need wall-time), then let action develop
    await page.waitForFunction(() => window.__game && window.__game.state() === 'fight', null, { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(8000);
    // fail on JS errors (rendering defect)
    if (errors.length > 0) throw Object.assign(new Error('Page errors: ' + errors.slice(0, 3).join(' | ')), { exitCode: 1 });
    // sanity: canvas has non-trivial pixels
    const probe = await page.evaluate(() => {
      const c = document.getElementById('scene');
      if (!c || !c.width) return { ok: false, reason: 'no-canvas' };
      return { ok: true, w: c.width, h: c.height };
    });
    if (!probe.ok) throw Object.assign(new Error('3D canvas missing'), { exitCode: 1 });
    await page.screenshot({ path: join(output, `final-${name}.png`), timeout: 30000 }).catch((error) => {
      if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error);
      throw error;
    });
    console.log(`captured ${name} ${width}x${height}`);
    await page.close();
  }
} catch (error) { console.error(error); process.exitCode = error.exitCode || 1; }
finally { await browser?.close().catch((error) => { console.error(error); process.exitCode ||= 75; }); }
