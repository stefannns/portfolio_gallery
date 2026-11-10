module.exports = async function check(page) {
  await page.locator('.app canvas').tap();
  await page.locator('.app[data-version="1"]').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.app[data-version="2"]').waitFor({ state: 'attached' });
  return { ok: true };
};
