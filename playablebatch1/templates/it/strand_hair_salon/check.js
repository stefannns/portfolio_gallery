module.exports = async function check(page) {
  await page.locator('canvas').first().waitFor({state: 'visible'});
  return {ok: true};
};
