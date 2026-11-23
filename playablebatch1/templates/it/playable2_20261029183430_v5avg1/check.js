// Gate 3: exercise actual input and assert a game-specific state change.
module.exports = async function check(page, ctx = {}) {
 const fs=require('fs'),path=require('path');
 const out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
 const assert=(value,message)=>{if(!value)throw Error(message);};
 async function box(selector){const item=page.locator(selector).first();await item.waitFor({state:'visible',timeout:6000});const rect=await item.boundingBox();assert(rect&&rect.width>30&&rect.height>30,'Missing game surface: '+selector);return rect;}
 async function tap(selector,x,y){const b=await box(selector);await page.mouse.click(b.x+b.width*x,b.y+b.height*y);}
 async function drag(selector,points){const b=await box(selector);await page.mouse.move(b.x+b.width*points[0][0],b.y+b.height*points[0][1]);await page.mouse.down();for(const [x,y]of points.slice(1))await page.mouse.move(b.x+b.width*x,b.y+b.height*y,{steps:12});await page.mouse.up();}
 async function circle(selector,cx,cy,rx,ry){const points=Array.from({length:41},(_,i)=>{const a=i/40*Math.PI*2;return[cx+Math.cos(a)*rx,cy+Math.sin(a)*ry];});await drag(selector,points);}
 try{
  await page.waitForSelector('#root',{timeout:5000});
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
  await page.screenshot({path:path.join(out,'initial.png')});
  await page.locator('.rugImage').waitFor({state:'visible'});
  const rug = await box('.rugStage');
  const left = {x:rug.x+rug.width*.2,y:rug.y+rug.height*.5};
  const right = {x:rug.x+rug.width*.8,y:left.y};
  for(const [tool,passes] of [['spray',3],['brush',5],['rinse',7],['vacuum',7]]) {
    const item = await box('[data-tool-id="'+tool+'"]');
    await page.mouse.move(item.x+item.width/2,item.y+item.height/2);
    await page.mouse.down();
    await page.mouse.move(left.x,left.y,{steps:12});
    for(let index=0;index<passes;index++) {
      const next=index%2===0?right:left;
      await page.mouse.move(next.x,next.y,{steps:18});
    }
    await page.mouse.up();
    await page.waitForTimeout(80);
  }
  await page.waitForFunction(()=>Number(document.querySelector('.textureOverlay').dataset.driedCells)>0,{timeout:3000});
  assert(await page.locator('.toolCursor').count()===0,'Tool remained stuck after release');
  await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'gameplay.png')});
  assert(!errors.length,errors.join('\n'));
  return{ok:true,screenshots:['.preview/initial.png','.preview/gameplay.png']};
 }finally{page.off('pageerror',onError);}
};
