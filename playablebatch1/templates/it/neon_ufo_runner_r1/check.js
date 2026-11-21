/*
 * Playwright check for Neon UFO Run.
 * The runner supplies an already-open page at the playable panel size;
 * we never navigate or resize and only inspect/interact with the game.
 */
module.exports = async function check(page, ctx = {}) {
  const app = page.locator('.app');
  const canvas = page.locator('.app canvas');
  await canvas.waitFor({state: 'attached', timeout: 8000});
  await page.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('data-phase') === 'idle',
    {timeout: 5000}
  );

  /* First gesture starts the run (standalone runner; in FYP the host sends playable-active). */
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no layout box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(cx + i * 14, cy - i * 9, {steps: 2});
    await page.waitForTimeout(60);
  }
  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('data-phase') === 'play',
    {timeout: 5000}
  );

  /* Auto flight + auto lasers should accumulate distance and shots. */
  await page.waitForFunction(
    () => Number(document.querySelector('.app')?.getAttribute('data-distance') || 0) > 24,
    {timeout: 8000}
  );
  await page.waitForFunction(
    () => Number(document.querySelector('.app')?.getAttribute('data-shots') || 0) > 0,
    {timeout: 6000}
  );

  const hullPips = await page.locator('.hud .pip').count();
  const heatBar = await page.locator('.hud .heat .bar i').count();
  if (hullPips !== 3) throw new Error(`expected 3 hull pips, got ${hullPips}`);
  if (heatBar !== 1) throw new Error('laser heat bar missing');

  const evidence = {
    phase: await app.getAttribute('data-phase'),
    distance: Number(await app.getAttribute('data-distance')),
    shots: Number(await app.getAttribute('data-shots')),
    kills: Number(await app.getAttribute('data-kills')),
    hullPips,
  };
  const outDir = ctx && (ctx.outputDir || ctx.workDir);
  if (outDir) {
    try {
      await page.screenshot({path: `${outDir}/neon-ufo-run-play.png`});
    } catch (error) { /* evidence is best effort */ }
  }
  return {ok: true, evidence};
};
