// Platform-supplied page/context: never navigate, resize, force buttons, or fake a photo.
module.exports=async function(page,ctx={}){
 const fs=require('fs'),path=require('path');
 const out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[],onError=error=>errors.push(String(error));page.on('pageerror',onError);
 const report={game:'107 camera_doodle_booth',cameraState:'idle',captureTested:false,unavailableUiTested:false};
 const assert=(value,message)=>{if(!value)throw Error(report.game+': '+message);};
 const shot=async name=>page.screenshot({path:path.join(out,name)});
 try{
  await page.locator('#root .fit').waitFor({state:'visible'});
  await page.locator('.strip-view').waitFor({state:'hidden'});
  assert(await page.locator('.strip-view').count()===1,'The loaded game does not contain its expected result panel.');
  await shot('initial.png');
  if(await page.locator('#root').getAttribute('data-camera')!=='enabled'){
   await page.locator('.cam-enable').waitFor({state:'visible'});
   assert(await page.locator('.shutter').isHidden(),'Capture should be hidden before enabling the camera.');
   await page.locator('.cam-enable').click();
  }
  try{
   await page.waitForFunction(()=>['enabled','unavailable'].includes(document.getElementById('root')?.dataset.camera),null,{timeout:17000});
  }catch(error){
   const state=await page.locator('#root').getAttribute('data-camera');
   if(state!=='requesting')throw error;
   // No permission response is possible in some preview workers. Test cancellation.
   await page.locator('.cam-enable').click();
   await page.waitForFunction(()=>document.getElementById('root')?.dataset.camera==='idle',null,{timeout:3000});
   report.cameraState='permission-pending-cancelled';
  }
  const cameraState=await page.locator('#root').getAttribute('data-camera');
  if(cameraState==='enabled'){
   report.cameraState='enabled';
   await page.locator('.shutter').waitFor({state:'visible'});
   assert(await page.locator('.cam-enable').isHidden(),'Enable camera must disappear when capture is ready.');
   await page.waitForFunction(()=>{
    const button=document.querySelector('.shutter'),video=document.querySelector('video.preview');
    return button&&!button.hidden&&!button.disabled&&video?.readyState>=2&&video.videoWidth>0&&video.videoHeight>0;
   },null,{timeout:10000});
   await page.locator('.shutter').click();
   await page.locator('.strip-view:not([hidden])').waitFor({state:'visible',timeout:20000});
   assert((await page.locator('#root').getAttribute('data-shots'))==='3','The strip must contain three captured photos.');
   report.captureTested=true;await shot('capture.png');
   await page.locator('.strip-view .retake').click();
   await page.locator('.strip-view').waitFor({state:'hidden'});
   await page.waitForFunction(()=>{const button=document.querySelector('.shutter');return button&&!button.hidden&&!button.disabled;},null,{timeout:5000});
  }else{
   if(report.cameraState!=='permission-pending-cancelled')report.cameraState=cameraState;
   assert(['unavailable','idle'].includes(cameraState),'Camera did not reach a recoverable state.');
   assert(await page.locator('.cam-enable').isVisible(),'Retry/enable control must remain available.');
   assert(await page.locator('.cam-enable').isEnabled(),'Retry/enable control is disabled.');
   assert(await page.locator('.shutter').isHidden()&&await page.locator('.shutter').isDisabled(),'Unavailable camera must not expose an unusable capture button.');
   assert(await page.locator('.strip-view').isHidden(),'No photo result may be fabricated without camera frames.');
   if(cameraState==='unavailable')assert(await page.locator('.cam-status').isVisible()&&Boolean((await page.locator('.cam-status').textContent()).trim()),'A readable camera-unavailable message is required.');
   report.unavailableUiTested=true;
  }
  await shot('interaction.png');
  assert(errors.length===0,errors.join('\n'));
  report.ok=true;return report;
 }finally{
  fs.writeFileSync(path.join(out,'camera-check.json'),JSON.stringify({...report,pageErrors:errors},null,2)+'\n');
  page.off('pageerror',onError);
 }
};
