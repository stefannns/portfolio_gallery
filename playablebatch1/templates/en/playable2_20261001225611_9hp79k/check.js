// Platform runner: the page is already open and sized by the host.
module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, {recursive:true});
  const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.waitForSelector('#root',{timeout:6000});await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,'initial.png')});
  const target = page.locator("button").first();
  await target.waitFor({state:'visible',timeout:6000});
  await target.click();
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'gameplay.png')});
  page.off('pageerror',onError);if(errors.length)throw Error(errors.join('\n'));
  return {ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
};
