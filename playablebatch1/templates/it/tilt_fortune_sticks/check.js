// Platform-supplied page: keep the real shake timing and wait for explicit states.
module.exports=async function(page,ctx={}){
 const fs=require('fs'),path=require('path'),out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[],onError=error=>errors.push(String(error));page.on('pageerror',onError);
 const report={game:'103 tilt_fortune_sticks',shakeInputs:0,pickStarted:false,resultTested:false,replayTested:false};
 const assert=(value,message)=>{if(!value)throw Error(report.game+': '+message);};
 const root=page.locator('#root');
 try{
  await page.locator('#root[data-phase="ready"]').waitFor({state:'visible',timeout:8000});
  await page.locator('.object').waitFor({state:'visible'});
  assert(await page.locator('.stick').count()===21,'Expected the fortune jar and its21 physical sticks.');
  await page.screenshot({path:path.join(out,'initial.png')});
  // Inputs must continue while the2.8s active-shake clock fills. Three instant
  // key presses accumulate too little effort and cannot ever trigger the pick.
  const deadline=Date.now()+15000;
  while(await root.getAttribute('data-phase')==='ready'&&Date.now()<deadline){
   await page.keyboard.press('Space');report.shakeInputs++;
   await page.waitForTimeout(140);
  }
  const phase=await root.getAttribute('data-phase');
  report.progress=await root.getAttribute('data-shake-progress');
  assert(phase==='picking'||phase==='revealed','Sustained shake did not start the pick; phase='+phase+', progress='+report.progress);
  report.pickStarted=true;
  // The lift, outward float and settle take3.55s after shaking completes.
  await page.locator('.result:not([hidden])').waitFor({state:'visible',timeout:12000});
  assert(await root.getAttribute('data-phase')==='revealed','Result did not reach the revealed state.');
  assert(Boolean((await page.locator('.paper h1').textContent()).trim()),'Fortune title is empty.');
  assert(Boolean((await page.locator('.paper p').textContent()).trim()),'Fortune description is empty.');
  assert(await page.locator('.stick[data-emerging="true"]').count()===1,'Exactly one stick should be chosen.');
  report.resultTested=true;await page.screenshot({path:path.join(out,'result.png')});
  await page.locator('.paper button').click();
  await page.waitForFunction(()=>document.getElementById('root')?.dataset.phase==='ready',null,{timeout:3000});
  await page.locator('.result').waitFor({state:'hidden'});
  assert(await page.locator('.stick[data-emerging="true"]').count()===0,'Replay did not restore the chosen stick.');
  assert(await page.locator('.stick').count()===21,'Replay lost a stick.');
  report.replayTested=true;await page.screenshot({path:path.join(out,'interaction.png')});
  assert(errors.length===0,errors.join('\n'));report.ok=true;return report;
 }finally{
  fs.writeFileSync(path.join(out,'fortune-check.json'),JSON.stringify({...report,pageErrors:errors},null,2)+'\n');page.off('pageerror',onError);
 }
};
