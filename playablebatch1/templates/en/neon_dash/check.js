module.exports = async function check(page) {
  await page.locator('canvas[aria-label="Neon Dash playfield"]').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Level 1',exact:true}).waitFor({state:'visible'});
  return {ok:true};
};
