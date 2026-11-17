// Platform check: use the supplied page without navigating or resizing it.
module.exports = async function(page, ctx = {}) {
 const fs = require('fs'), path = require('path');
 const out = path.resolve(ctx.workDir || process.cwd(), '.preview');fs.mkdirSync(out,{recursive:true});
 const errors=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
 await page.locator('#root').waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'initial.png')});
 await page.keyboard.press('Space');await page.keyboard.press('Space');await page.keyboard.press('Space');
 await page.locator('.result:not([hidden])').waitFor({state:'visible'});
 await page.locator('.paper button').click();
 if(await page.locator('#root').getAttribute('data-phase')!=='ready')throw Error('Replay did not reset fortune');
 await page.screenshot({path:path.join(out,'interaction.png')});page.off('pageerror',onError);
 if(errors.length)throw Error(errors.join('\n'));
 return {ok:true,screenshots:['.preview/initial.png','.preview/interaction.png']};
};
