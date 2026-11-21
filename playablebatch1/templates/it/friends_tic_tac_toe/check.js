// Supplied platform page and context; never navigate or change its viewport.
module.exports=async function(page,ctx={}){
 const fs=require('fs'),path=require('path'),out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[];const onError=e=>errors.push(String(e));page.on('pageerror',onError);
 await page.locator('#root .fit').waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'initial.png')});
 async function drag(selector,x1,y1,x2,y2){const b=await page.locator(selector).boundingBox();await page.mouse.move(b.x+b.width*x1,b.y+b.height*y1);await page.mouse.down();await page.mouse.move(b.x+b.width*x2,b.y+b.height*y2,{steps:12});await page.mouse.up();}
 const b=await page.locator('canvas.stage').boundingBox();await page.mouse.click(b.x+b.width*.25,b.y+b.height*.37);await page.waitForFunction(()=>Number(document.querySelector('#root').dataset.moves)>=2);
 await page.screenshot({path:path.join(out,'interaction.png')});page.off('pageerror',onError);
 if(errors.length)throw Error(errors.join('\n'));
 return{ok:true,screenshots:['.preview/initial.png','.preview/interaction.png']};
};
