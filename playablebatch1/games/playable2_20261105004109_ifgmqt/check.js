module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, { recursive: true });
  const errors = [], onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  try {
    await page.waitForSelector('.app-shell[data-phase="idle"]', { timeout: 4000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, 'initial.png') });
    const box = await page.locator('.game-canvas').boundingBox();
    if (!box) throw Error('Missing game canvas');
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .65);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .68, box.y + box.height * .60, { steps: 12 });
    await page.waitForTimeout(1000);
    await page.mouse.up();
    if (await page.locator('.app-shell').getAttribute('data-phase') !== 'running') throw Error('Drag did not start the run');
    await page.screenshot({ path: path.join(out, 'gameplay.png') });
    if (errors.length) throw Error(errors.join('\n'));
    return { ok: true };
  } finally {
    await page.mouse.up();
    page.off('pageerror', onError);
  }
};
