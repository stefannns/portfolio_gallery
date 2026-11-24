// Continuous bounded pointer gestures use the real input path: a tap must not fire, and five missed flicks share one spot.
module.exports = async function(page, ctx = {}) {
  const assert = (value, message) => { if (!value) throw Error('125b: ' + message); };
  const errors = [], onError = error => errors.push(String(error)); page.on('pageerror', onError);
  try {
    let frame = page;
    if (!await frame.locator('[data-testid="game"]').count()) {
      for (const candidate of page.frames()) if (await candidate.locator('[data-testid="game"]').count()) { frame = candidate; break; }
    }
    const game=frame.locator('[data-testid="game"]'),canvas=frame.locator('[data-testid="throw-surface"] canvas');
    await canvas.waitFor({state:'visible',timeout:12000});
    if (await game.getAttribute('data-paused')==='true') {
      const entry=page.getByRole('button',{name:/Gioca: 125b|Play: 125b|Tap to play|Tocca per giocare/i});
      assert(await entry.count()>0,'Enter the FYP game before running its check');await entry.first().click();
    }
    await frame.waitForFunction(()=>document.querySelector('[data-testid="game"]')?.dataset.paused==='false',undefined,{timeout:5000});
    await frame.waitForFunction(()=>document.querySelector('[data-testid="game"]')?.dataset.state==='ready',undefined,{timeout:5000});
    const start=Number(await game.getAttribute('data-attempts'));
    assert(start===0,'Fresh game expected');
    assert(await game.getAttribute('data-spot-attempts')==='0','Fresh spot must start with five available attempts');
    const spot=await game.getAttribute('data-spot-id'),target=[await game.getAttribute('data-target-x'),await game.getAttribute('data-target-z')];
    await canvas.click();await page.waitForTimeout(120);
    assert(await game.getAttribute('data-attempts')==='0','A tap must not shoot or consume an attempt');
    const rounds=[];
    for(let attempt=1;attempt<=5;attempt++){
      let registered=false;
      const gestures=[];
      for(let dispatch=1;dispatch<=3;dispatch++){
        await frame.waitForFunction(()=>{const d=document.querySelector('[data-testid="game"]')?.dataset;return d?.state==='ready'&&d.paused==='false';},undefined,{timeout:5000});
        const box=await canvas.boundingBox();assert(box&&box.height>100&&box.width>100,'Measured input surface required');
        const from={x:box.x+box.width*.12,y:box.y+box.height*.82};
        const to={x:from.x+Math.min(box.height*.40,box.width*.76),y:box.y+box.height*.46};
        // Keep both ends inside short and tall hosts. Send continuous motion in
        // one Playwright call; pauses/round trips can age out the170ms flick window.
        await page.mouse.move(from.x,from.y);await page.mouse.down();
        try{await page.mouse.move(to.x,to.y,{steps:8});}finally{await page.mouse.up();}
        try{
          await frame.waitForFunction(expected=>Number(document.querySelector('[data-testid="game"]')?.dataset.attempts)>=expected,attempt,{timeout:2500});
        }catch(error){
          const count=Number(await game.getAttribute('data-attempts'));
          assert(count===attempt-1&&await game.getAttribute('data-state')==='ready'&&await game.getAttribute('data-paused')==='false',
            'Flick wait failed in an unexpected state: attempts='+count+', expected='+attempt+'; '+String(error));
        }
        const count=Number(await game.getAttribute('data-attempts'));
        gestures.push({dispatch,registered:count===attempt});
        assert(count<=attempt,'One flick fired more than one needle');
        if(count===attempt){registered=true;break;}
        // A rejected/cancelled gesture consumes no game attempt. Retry only that
        // input, never skip the real shot, target persistence or five-try checks.
        assert(count===attempt-1,'Attempt count changed unexpectedly');
      }
      assert(registered,'No flick registered after three continuous gestures; check pointer delivery in the host');
      await frame.waitForFunction(expected=>{const d=document.querySelector('[data-testid="game"]')?.dataset;return d?.state==='ready'&&Number(d.attempts)===expected;},attempt,{timeout:10000});
      assert(await game.getAttribute('data-last-outcome')!=='bliss','The deliberately wide test shot unexpectedly hit the target');
      if(attempt<5){
        assert(await game.getAttribute('data-spot-id')===spot,'Miss advanced the spot before five tries');
        assert(await game.getAttribute('data-target-x')===target[0]&&await game.getAttribute('data-target-z')===target[1],'Retry moved the target');
        assert(Number(await game.getAttribute('data-spot-attempts'))===attempt,'Per-spot count differs from actual flicks');
      }else{
        assert(Number(await game.getAttribute('data-spot-id'))===Number(spot)+1,'Fifth miss must advance exactly one spot');
        assert(await game.getAttribute('data-spot-attempts')==='0','New spot must restore all five tries');
      }
      rounds.push({attempt,gestures,spot:await game.getAttribute('data-spot-id'),spotAttempts:await game.getAttribute('data-spot-attempts')});
    }
    assert(errors.length===0,errors.join('\n'));
    if(ctx.workDir){const fs=require('fs'),path=require('path'),out=path.join(ctx.workDir,'.preview');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'125b-check.json'),JSON.stringify({ok:true,rounds},null,2)+'\n');}
    return{ok:true,flow:'flick-five-tries',rounds};
  }finally{page.off('pageerror',onError);}
};
