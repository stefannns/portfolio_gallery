// Supplied platform page and context; never navigate or change its viewport.
module.exports=async function(page,ctx={}){
 const fs=require('fs'),path=require('path'),out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[];const onError=e=>errors.push(String(e));page.on('pageerror',onError);
 await page.locator('#root .fit').waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'initial.png')});
 async function drag(selector,x1,y1,x2,y2){const b=await page.locator(selector).boundingBox();await page.mouse.move(b.x+b.width*x1,b.y+b.height*y1);await page.mouse.down();await page.mouse.move(b.x+b.width*x2,b.y+b.height*y2,{steps:12});await page.mouse.up();}
 await drag('canvas.stage',.5,420/598,.5,490/598);if(await page.locator('#root').getAttribute('data-shots')!=='1')throw Error('Cue shot failed');
 await page.screenshot({path:path.join(out,'interaction.png')});page.off('pageerror',onError);
 if(errors.length)throw Error(errors.join('\n'));
 return{ok:true,screenshots:['.preview/initial.png','.preview/interaction.png']};
};
