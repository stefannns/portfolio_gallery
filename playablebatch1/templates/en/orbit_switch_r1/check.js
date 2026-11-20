module.exports = async function(page, ctx = {}) {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const canvas=page.locator('.orbit-game canvas');
  await canvas.waitFor({state:'visible'});
  const expect=async (key,value)=>{await page.waitForFunction(({key,value})=>document.querySelector('.orbit-game canvas')?.dataset[key]===value,{key,value});};
  if(await canvas.getAttribute('data-phase')!=='waiting') throw new Error('Game must initially wait');
  await canvas.click();await expect('phase','playing');
  const before=await canvas.getAttribute('data-lane');
  await canvas.click();await expect('lane',before==='1'?'-1':'1');
  await expect('phase','lost');
  await page.waitForTimeout(700);await page.locator('.replay').click();await expect('phase','playing');
  if(await canvas.getAttribute('data-score')!=='0')throw new Error('Replay did not reset score');
  if(errors.length)throw new Error(errors.join('\n'));
  if(ctx.outputDir)await page.screenshot({path:require('path').join(ctx.outputDir,'orbit-replay.png')});
  return {ok:true,checks:['first frame','start','inside/outside switch','pin failure','replay reset'],errors};
};
