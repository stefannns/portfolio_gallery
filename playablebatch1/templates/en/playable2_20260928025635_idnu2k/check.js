// Platform runner: the page is already open and sized by the host.
module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, {recursive:true});
  const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.waitForSelector('#root',{timeout:6000});await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,'initial.png')});
  const image = await page.evaluate(() => {
    const c=document.createElement('canvas');c.width=96;c.height=96;const g=c.getContext('2d');
    g.fillStyle='#e4b89e';g.fillRect(0,0,96,96);g.fillStyle='#5a4a43';g.fillRect(28,30,12,8);g.fillRect(56,30,12,8);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.locator('canvas').first().waitFor({state:'visible',timeout:6000});
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'gameplay.png')});
  page.off('pageerror',onError);if(errors.length)throw Error(errors.join('\n'));
  return {ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
};
