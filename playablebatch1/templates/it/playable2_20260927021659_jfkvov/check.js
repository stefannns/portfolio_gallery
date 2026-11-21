// Platform runner: finish four preference questions without invoking share/save APIs.
module.exports = async function(page, ctx = {}) {
  const fs=require('fs'),path=require('path');const out=path.resolve(ctx.workDir||process.cwd(),'.preview');fs.mkdirSync(out,{recursive:true});
  await page.locator('.couple-options .btn-option').first().waitFor({state:'visible',timeout:6000});
  await page.screenshot({path:path.join(out,'initial.png')});
  for(let i=0;i<4;i++)await page.locator('.couple-options .btn-option').first().click();
  await page.locator('.solo-result').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'result.png')});
  return {ok:true,screenshots:['.preview/initial.png','.preview/result.png']};
};
