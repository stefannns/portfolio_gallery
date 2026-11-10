// Platform Gate 3 contract: no navigation or viewport changes.
module.exports = async function(page, ctx = {}) {
  const fs = require('fs'), path = require('path');
  const out = path.resolve(ctx.workDir || process.cwd(), '.preview');
  fs.mkdirSync(out, {recursive:true});
  const errors = [];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.waitForSelector('#root', {timeout:4000});
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(out,'initial.png')});
  const size=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
  const x=size.w*.5,y=size.h*.52;
  const red=page.getByRole('button',{name:'Area di tocco del giocatore rosso',exact:true});
  for(let i=0;i<3;i++)await red.click();
  const status=await page.locator('.tap-duel__sr-only').textContent();
  if(!status.includes('62'))throw Error('Duel input did not move the divider');
  await page.waitForTimeout(650);
  await page.screenshot({path:path.join(out,'gameplay.png')});
  page.off('pageerror',onError);
  if(errors.length)throw Error(errors.join('\n'));
  return {ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
};
