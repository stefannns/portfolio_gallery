module.exports = async function(page, ctx = {}) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  const listen = e => errors.push(e.message);
  page.on('pageerror', listen);
  try {
    let frame = page;
    if (!await page.locator('[data-testid="game"]').count()) {
      for (const candidate of page.frames()) {
        if (await candidate.locator('[data-testid="game"]').count()) { frame = candidate; break; }
      }
    }
    const game = frame.locator('[data-testid="game"]');
    await game.waitFor({ state: 'visible', timeout: 12000 });
    await frame.waitForFunction(() => !!window.__acupuncture, undefined, { timeout: 12000 });
    const avatar = frame.locator('[data-testid="friend-avatar"] img');
    assert(await avatar.evaluate(img => img.complete && img.naturalWidth > 0), 'Packaged avatar must render');
    assert(await frame.locator('[data-testid="avatar-input"]').getAttribute('accept') === 'image/*', 'Actual local image chooser must exist');
    await frame.evaluate(() => document.fonts.ready);
    assert(await frame.evaluate(() => document.fonts.check('700 28px Poppins')), 'Poppins Bold must load');
    const wasActive = await frame.evaluate(() => window.__acupuncture.active);
    if (!wasActive) {
      let entry;
      for (const candidate of page.frames()) {
        const button = candidate.getByText('Tap to play', { exact: false });
        if (await button.count() && await button.first().isVisible()) { entry = button.first(); break; }
      }
      assert(!!entry, 'Enter through original FYP before running check');
      await entry.click();
      await frame.waitForFunction(() => window.__acupuncture.active, undefined, { timeout: 5000 });
    }
    assert(await game.getAttribute('data-state') === 'ready', 'Ready scene expected');
    const canvas = frame.locator('[data-testid="throw-surface"] canvas');
    const box = await canvas.boundingBox();
    assert(box && box.height > 100 && box.width > 100, 'Measured 3D stage expected');
    const hint = frame.locator('[data-testid="hint"]');
    assert(await hint.isVisible(), 'Instruction visible before gameplay');
    // Real mouse/pointer swipe. No injected throw/score shortcuts or navigation.
    await page.mouse.move(box.x + box.width * .50, box.y + box.height * .80);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + box.width * (.50 + .025 * i / 10), box.y + box.height * (.80 - .32 * i / 10));
      await page.waitForTimeout(24);
    }
    await page.mouse.up();
    await frame.locator('[data-testid="result"]').waitFor({ state: 'visible', timeout: 10000 });
    assert(!await hint.count(), 'Meaningful swipe must dismiss hint');
    const score = Number(await game.getAttribute('data-score'));
    assert(Number.isInteger(score) && score >= 0 && score <= 100, 'Score must be 0–100');
    const outcome = await game.getAttribute('data-outcome');
    assert(['bliss', 'ouch', 'miss'].includes(outcome), 'A physical throw must resolve');
    assert(await frame.locator('[data-testid="friend-avatar"]').getAttribute('data-reaction') === outcome, 'Avatar reaction must match gameplay');
    await frame.locator('[data-testid="replay"]').click();
    await frame.waitForFunction(() => document.querySelector('[data-testid="game"]').dataset.state === 'ready');
    assert(await game.getAttribute('data-score') === '0', 'Replay clears score');
    assert(await frame.locator('[data-testid="hint"]').isVisible(), 'Replay restores swipe guide');
    assert(await avatar.isVisible(), 'Avatar remains after replay');
    assert(errors.length === 0, `Runtime errors: ${errors.join('; ')}`);
    if (ctx.outputDir) {
      const path = require('path');
      await page.screenshot({ path: path.join(ctx.outputDir, 'acupuncture-friends-replay.png') });
    }
    return { ok: true, score, outcome, avatar: 'rendered', replay: 'ready' };
  } finally { page.off('pageerror', listen); }
};
