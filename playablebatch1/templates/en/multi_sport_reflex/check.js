module.exports = async function check(page) {
  await page.locator('[data-kind="0"]').first().waitFor({state: 'visible'});
  return {ok: true};
};
