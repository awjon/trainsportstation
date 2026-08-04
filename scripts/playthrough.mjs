// Drives the real game in a real browser and captures each beat of the loop (docs/70 M6.4
// gate G5). This is the check no unit test can make: that the vertical slice is actually
// *playable* — preview, build under the countdown, dispatch, watch, payoff, receipt.
//
// Needs Playwright + the preinstalled Chromium, and the game served (npm run preview):
//   BASE_URL=http://localhost:4181 node scripts/playthrough.mjs [outDir]

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:4181';
const OUT = process.argv[2] ?? 'shots';

const shots = [];

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  shots.push(name);
  console.log(`  captured ${name}`);
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await mkdir(OUT, { recursive: true });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30_000 });

// 1. Preview — the stage card, before the clock starts
await shot(page, '1-preview');

// 2. Countdown — build the author's line while the ring drains
await page.getByRole('button', { name: /Start building/ }).click();
await page.waitForTimeout(300);
await shot(page, '2-countdown');

// Lay the line by clicking cells, exactly as a player would. The four straights of w1-s1 sit
// at x=2..5, z=3, so the click point for each is found by sweeping across the board and reading
// back which cell got filled — the same picking path the player's mouse goes through.
const box = await (await page.$('#app')).boundingBox();
await page.keyboard.press('r'); // rotate the straight to E–W

const placed = new Set();
for (let step = 0; step < 40 && placed.size < 5; step++) {
  const x = box.x + box.width * (0.3 + step * 0.012);
  const y = box.y + box.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await page.waitForTimeout(60);
  const label = await page.locator('.hud-goals .goal').nth(1).locator('.goal-detail').textContent();
  placed.add(label);
}
console.log(`  board: ${[...placed].pop()}`);
await shot(page, '3-building');

// 3. Dispatch early and watch the run
await page.keyboard.press('Space');
await page.waitForTimeout(2500);
await shot(page, '4-watch');

// 4. Wait for the run to resolve. Software rendering runs several times slower than real time
// (the loop clamps ticks per frame rather than skipping them), so wait on the panel, not a clock.
await page.locator('.panel:not(.hidden) .card h1').first().waitFor({ timeout: 120_000 });
await shot(page, '5-resolve');

const continueBtn = page.getByRole('button', { name: /Continue|See the tally/ });
if (await continueBtn.count()) {
  await continueBtn.first().click();
  await page.waitForTimeout(800);
  await shot(page, '6-results');
}

await browser.close();

console.log(`\n${shots.length} shots in ${OUT}/`);
if (errors.length) {
  console.error(`\n${errors.length} page errors:`);
  for (const e of errors.slice(0, 10)) console.error('  ' + e);
  process.exit(1);
}
console.log('no page errors');
