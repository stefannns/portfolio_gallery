// Platform runner: the page is already open and sized by the host.
module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, {recursive:true});
  const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.waitForSelector('#root',{timeout:6000});await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,'initial.png')});
  const image = await page.evaluate(() => {
    const c=document.createElement('canvas');c.width=320;c.height=420;const g=c.getContext('2d');
    g.fillStyle='#d4e8e1';g.fillRect(0,0,320,420);g.fillStyle='#bd795c';g.fillRect(90,100,140,160);
    g.fillStyle='#302621';g.fillRect(120,145,15,12);g.fillRect(185,145,15,12);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#photo-input').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.locator('#photo-options').waitFor({state:'visible',timeout:6000});
  const box=await page.locator('#photo-crop').boundingBox();if(!box)throw Error('Manual crop is missing');
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.55,{steps:6});await page.mouse.up();
  await page.locator('#photo-zoom').evaluate(el=>{el.value='1.5';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#apply-photo').click();await page.locator('#default-button').waitFor({state:'visible',timeout:6000});
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'gameplay.png')});
  page.off('pageerror',onError);if(errors.length)throw Error(errors.join('\n'));
  return {ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
};
