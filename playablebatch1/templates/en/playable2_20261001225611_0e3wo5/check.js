// Platform runner: the page is already open and sized by the host.
module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, {recursive:true});
  const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.waitForSelector('#root',{timeout:6000});await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,'initial.png')});
  const target = page.locator(".joystick").first();
  await target.waitFor({state:'visible',timeout:6000});
  const box=await target.boundingBox();if(!box)throw Error('Gameplay target has no bounds');
  let x=box.x+box.width*.5,y=box.y+box.height*.65;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+Math.min(70,box.width*.2),y-Math.min(65,box.height*.18),{steps:8});
  await page.mouse.up();
  await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'gameplay.png')});
  page.off('pageerror',onError);if(errors.length)throw Error(errors.join('\n'));
  return {ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
};
