// Platform check: use the supplied page without navigating or resizing it.
module.exports = async function(page, ctx = {}) {
 const fs = require('fs'), path = require('path');
 const out = path.resolve(ctx.workDir || process.cwd(), '.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
 await page.locator('#root').waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'initial.png')});
 await page.locator('canvas').click();
 await page.waitForFunction(()=>document.getElementById('root').dataset.phase==='playing');
 await page.screenshot({path:path.join(out,'interaction.png')});page.off('pageerror',onError);
 if(errors.length)throw Error(errors.join('\n'));
 return {ok:true,screenshots:['.preview/initial.png','.preview/interaction.png']};
};
