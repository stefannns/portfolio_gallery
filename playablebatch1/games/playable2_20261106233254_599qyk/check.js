module.exports = async function check(page) {
  await page.locator('.stage').tap();
  await page.locator('.game[data-launches="1"]').waitFor({ state: 'attached' });
  return { ok: true };
};
