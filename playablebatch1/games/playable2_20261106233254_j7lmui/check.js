module.exports = async function check(page) {
  const scene = page.locator('.scene canvas');
  await scene.waitFor({ state: 'visible' });
  const box = await scene.boundingBox();
  await page.mouse.move(box.x + box.width * .42, box.y + box.height * .55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .63, box.y + box.height * .48, { steps: 5 });
  await page.mouse.up();
  await page.locator('.app[data-phase="playing"] .timer').waitFor({ state: 'visible' });
  return { ok: true };
};
