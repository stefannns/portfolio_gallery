module.exports = async function check(page) {
  const scene = page.locator('.scene canvas');
  await scene.waitFor({ state: 'visible' });
  const box = await scene.boundingBox();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Brake', exact: true }).waitFor({ state: 'visible' });
  return { ok: true };
};
