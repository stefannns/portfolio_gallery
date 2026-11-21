// Platform runner: make two real swipes in the continuous acupuncture game.
// No injected throws, score setters, sharing, image picker, or navigation.
module.exports = async function(page, ctx = {}) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    let frame = page;
    if (!await page.locator('[data-testid="game"]').count()) {
      for (const candidate of page.frames()) {
        if (await candidate.locator('[data-testid="game"]').count()) { frame = candidate; break; }
      }
    }
    const game = frame.locator('[data-testid="game"]');
    const canvas = frame.locator('[data-testid="throw-surface"] canvas');
    await game.waitFor({ state: 'visible', timeout: 12000 });
    await canvas.waitFor({ state: 'visible', timeout: 12000 });
    await frame.evaluate(() => document.fonts.ready);
    assert(await frame.evaluate(() => document.fonts.check('700 28px Poppins')), 'Score font must load');

    // The host owns FYP entry. Use its real button if this frame is inactive.
    if (await game.getAttribute('data-paused') === 'true') {
      let entry;
      for (const candidate of page.frames()) {
        const button = candidate.getByText(/Tap to play|Tocca per giocare/i);
        if (await button.count() && await button.first().isVisible()) { entry = button.first(); break; }
      }
      assert(!!entry, 'Enter through original FYP before running check');
      await entry.click();
      await frame.waitForFunction(() => document.querySelector('[data-testid="game"]')?.dataset.paused === 'false', undefined, { timeout: 5000 });
    }

    await frame.waitForFunction(() => document.querySelector('[data-testid="game"]')?.dataset.state === 'ready', undefined, { timeout: 12000 });
    assert(await frame.locator('[data-testid="friend-avatar"]').count() === 0, 'Friend profile must be absent');
    assert(await frame.locator('[data-testid="avatar-input"], input[type="file"]').count() === 0, 'Photo chooser must be absent');
    assert(await frame.locator('[data-testid="result"], [data-testid="replay"]').count() === 0, 'Continuous play must not require result/replay UI');
    assert(await game.getAttribute('data-attempts') !== null, 'Observable attempt counter is required');

    const initialAttempts = Number(await game.getAttribute('data-attempts'));
    let previousScore = Number(await game.getAttribute('data-score'));
    assert(Number.isInteger(initialAttempts) && initialAttempts >= 0, 'Initial attempt count must be a nonnegative integer');
    assert(Number.isInteger(previousScore) && previousScore >= 0, 'Initial cumulative score must be a nonnegative integer');
    if (initialAttempts === 0) assert(await frame.locator('[data-testid="hint"]').isVisible(), 'First-attempt guide must be visible');
    const attempts = [];

    for (let round = 1; round <= 2; round++) {
      const box = await canvas.boundingBox();
      assert(box && box.height > 100 && box.width > 100, 'Measured 3D throw surface expected');
      // A physical upward swipe, including multiple motion samples, drives the real needle physics.
      await page.mouse.move(box.x + box.width * .50, box.y + box.height * .80);
      await page.mouse.down();
      for (let step = 1; step <= 10; step++) {
        await page.mouse.move(box.x + box.width * (.50 + .025 * step / 10), box.y + box.height * (.80 - .32 * step / 10));
        await page.waitForTimeout(24);
      }
      await page.mouse.up();
      const expectedAttempts = initialAttempts + round;
      await frame.waitForFunction(expected => Number(document.querySelector('[data-testid="game"]')?.dataset.attempts) === expected, expectedAttempts, { timeout: 5000 });
      assert(await frame.locator('[data-testid="hint"]').count() === 0, 'Guide must dismiss after the first meaningful swipe');
      await frame.waitForFunction(expected => {
        const node = document.querySelector('[data-testid="game"]');
        return node?.dataset.state === 'ready' && Number(node.dataset.attempts) === expected;
      }, expectedAttempts, { timeout: 12000 });

      const score = Number(await game.getAttribute('data-score'));
      assert(Number.isInteger(score) && score >= previousScore, 'A new attempt must preserve or increase cumulative score');
      assert(await frame.locator('[data-testid="hint"]').count() === 0, 'Auto-ready must not restore the first-throw guide');
      assert(await frame.locator('[data-testid="result"], [data-testid="replay"]').count() === 0, 'Next throw must be available without a replay click');
      const outcome = await game.getAttribute('data-last-outcome');
      if (outcome) assert(['bliss', 'ouch', 'miss'].includes(outcome), 'Last outcome must describe the resolved physical throw');
      attempts.push({ attempt: expectedAttempts, score, ...(outcome ? { outcome } : {}) });
      previousScore = score;
    }

    assert(errors.length === 0, `Runtime errors: ${errors.join('; ')}`);
    if (ctx.outputDir) {
      const fs = require('fs'), path = require('path');
      fs.mkdirSync(ctx.outputDir, { recursive: true });
      await page.screenshot({ path: path.join(ctx.outputDir, 'acupuncture-friends-two-attempts.png') });
    }
    return { ok: true, flow: 'continuous', initialAttempts, attempts, score: previousScore, state: 'ready', profile: 'absent', hint: 'dismissed' };
  } finally { page.off('pageerror', onError); }
};
