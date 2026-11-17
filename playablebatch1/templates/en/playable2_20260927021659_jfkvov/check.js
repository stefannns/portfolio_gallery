// Platform runner: exercise the first paired round in the already-open game.
module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, {recursive:true});
  await page.locator('.couple-options .btn-option').first().waitFor({state:'visible',timeout:6000});
  await page.screenshot({path:path.join(out,'initial.png')});
  await page.locator('.couple-options .btn-option').first().click();
  await page.locator('.handoff-button').click();
  await page.locator('.couple-options .btn-option').first().click();
  await page.locator('.couple-feedback').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'gameplay.png')});
  return {ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
};
