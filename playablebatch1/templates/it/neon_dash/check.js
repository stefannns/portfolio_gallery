module.exports = async function check(page) {
  await page.locator('canvas[aria-label="Campo di Scatto neon"]').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Livello 1',exact:true}).waitFor({state:'visible'});
  return {ok:true};
};
