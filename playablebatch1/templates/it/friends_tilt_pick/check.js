// Use the supplied game page; assertions follow state rather than localized copy.
module.exports=async function(page,ctx={}){
 const fs=require('fs'),path=require('path'),out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[],onError=error=>errors.push(String(error));page.on('pageerror',onError);
 const report={game:'121 friends_tilt_pick',questions:5,choices:[],winnerTested:false,replayTested:false};
 const assert=(value,message)=>{if(!value)throw Error(report.game+': '+message);};
 const waitQuestion=number=>page.waitForFunction(expected=>{
  const numbers=document.querySelector('.count')?.textContent.match(/\d+/g)?.map(Number);
  return numbers?.[0]===expected&&numbers?.[1]===5;
 },number,{timeout:4500});
 try{
  await page.locator('#root .fit').waitFor({state:'visible'});
  assert(await page.locator('.choice').count()===2,'Expected two friend choices; verify that the correct package is loaded.');
  assert(await page.locator('.shutter,.strip-view').count()===0,'A camera-game page was loaded instead of Tilt Pick.');
  await waitQuestion(1);await page.screenshot({path:path.join(out,'initial.png')});
  const names=await page.locator('.choice').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
  assert(names.every(Boolean),'Both friends need accessible names.');
  for(let question=1;question<=5;question++){
   await waitQuestion(question);
   const pair=await page.locator('.choice').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
   assert(JSON.stringify(pair)===JSON.stringify(names),'The two friends changed during the five questions.');
   const side=question<=3?'left':'right';report.choices.push(side);
   await page.locator('.choice.'+side).click();
  }
  await page.locator('.modal:not([hidden])').waitFor({state:'visible',timeout:4500});
  assert((await page.locator('.result .value').textContent()).trim()===names[0],'Final winner must reflect all five choices, not just the last one.');
  report.winnerTested=true;await page.screenshot({path:path.join(out,'result.png')});
  await page.locator('.result button').click();await waitQuestion(1);
  await page.locator('.modal').waitFor({state:'hidden'});
  const replayPair=await page.locator('.choice').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
  assert(JSON.stringify(replayPair)===JSON.stringify(names),'The two friends changed on replay.');report.replayTested=true;
  await page.screenshot({path:path.join(out,'interaction.png')});
  assert(errors.length===0,errors.join('\n'));report.ok=true;return report;
 }finally{
  fs.writeFileSync(path.join(out,'tilt-check.json'),JSON.stringify({...report,pageErrors:errors},null,2)+'\n');page.off('pageerror',onError);
 }
};
