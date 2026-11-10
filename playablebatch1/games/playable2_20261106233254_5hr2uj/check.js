module.exports = async function check(page) {
  await page.locator('.paper').waitFor({ state: 'visible' });
  const box = await page.locator('.paper').boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .68, { steps: 5 });
  await page.mouse.up();
  await page.locator('.draw-stage .primary').click();
  await page.locator('.arena canvas').waitFor({ state: 'visible' });
  return { ok: true };
};
