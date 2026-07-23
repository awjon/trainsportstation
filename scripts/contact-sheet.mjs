// Render the asset lab from several angles into lab-shots/ for review.
// Needs Playwright + the preinstalled Chromium, and the lab served (npm run preview).
//   BASE_URL=http://localhost:4178 node scripts/contact-sheet.mjs
// Run with the global Playwright on PATH via NODE_PATH if it isn't a local dep.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4178';
const OUT = process.env.OUT ?? 'lab-shots';
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: 'overview', q: 'view=overview' },
  { name: 'track', q: 'view=track' },
  { name: 'stock', q: 'view=stock' },
  { name: 'town', q: 'view=town' },
  { name: 'focus-locomotive', q: 'focus=locomotive' },
  { name: 'focus-station', q: 'focus=station' },
  { name: 'focus-junction', q: 'focus=junction' },
  { name: 'focus-carriage-passenger', q: 'focus=carriage-passenger' },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

for (const s of shots) {
  await page.goto(`${BASE}/?${s.q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__labReady === true', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log('shot', s.name);
}
console.log('ERRORS', errors.filter((e) => !e.includes('favicon')).length ? errors : 'none');
await browser.close();
