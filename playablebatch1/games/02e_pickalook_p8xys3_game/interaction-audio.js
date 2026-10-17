/* Original procedural SFX. No samples, remote requests or audio before a valid gesture. */
(function(host){
  'use strict';
  const profiles={
    fur:{gain:.055,high:110,low:900,hold:120,attack:.025,release:.08},
    scratch:{gain:.085,high:480,low:3200,hold:110,attack:.018,release:.065},
    steam:{gain:.04,high:750,low:5000,hold:180,attack:.035,release:.1},
    outfit:{gain:.06,high:700,low:2600,hold:90,attack:.008,release:.065}
  };
  function create(kind){
    const profile=profiles[kind]||profiles.scratch,doc=host.document;
    let context=null,buffer=null,voice=null,idle=null,pending=null,intent=null,epoch=0,disposed=false,bound=false;
    const active=new Set(),timers=new Set();
    const now=()=>host.performance?.now?.()??Date.now();
    const later=(fn,ms)=>{const id=host.setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;};
    const cancel=id=>{if(id!==null){host.clearTimeout(id);timers.delete(id);}};
    function destroy(node){if(!node||!active.has(node))return;active.delete(node);
      if(node.cleanup!==undefined)cancel(node.cleanup);
      for(const source of node.sources)try{source.stop();}catch{}
      for(const part of node.nodes)try{part.disconnect();}catch{}
    }
    function noise(){
      if(buffer)return buffer;
      buffer=context.createBuffer(1,Math.ceil(context.sampleRate*2),context.sampleRate);
      const data=buffer.getChannelData(0);let seed=76073,brown=0;
      for(let i=0;i<data.length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        const white=seed/2147483648-1;brown=(brown+.02*white)/1.02;
        data[i]=kind==='fur'?brown*3.5:white*.78+brown*.6;
      }
      return buffer;
    }
    function makeVoice(loop){
      const source=context.createBufferSource(),high=context.createBiquadFilter(),low=context.createBiquadFilter(),gain=context.createGain();
      source.buffer=noise();source.loop=loop;
      high.type='highpass';high.frequency.value=profile.high;high.Q.value=.5;
      low.type='lowpass';low.frequency.value=profile.low;low.Q.value=.5;
      gain.gain.value=0;source.connect(high);high.connect(low);low.connect(gain);gain.connect(context.destination);
      const node={sources:[source],nodes:[source,high,low,gain],gain};
      active.add(node);if(active.size>4)destroy(active.values().next().value);
      source.start();return node;
    }
    function fade(){
      if(!voice||!context)return;
      const node=voice;voice=null;
      try{node.gain.gain.cancelScheduledValues(context.currentTime);node.gain.gain.setTargetAtTime(0,context.currentTime,profile.release/3);}catch{}
      node.cleanup=later(()=>destroy(node),Math.ceil(profile.release*1000)+25);
    }
    function stop(){intent=null;cancel(idle);idle=null;fade();}
    function playMotion(force){
      if(!context||context.state!=='running'||disposed||doc?.hidden)return;
      if(!voice||!active.has(voice))voice=makeVoice(true);
      const value=profile.gain*(.55+.45*Math.max(0,Math.min(1,Number(force)||0)));
      voice.gain.gain.cancelScheduledValues(context.currentTime);
      voice.gain.gain.setTargetAtTime(value,context.currentTime,profile.attack);
      cancel(idle);idle=later(()=>{idle=null;stop();},profile.hold);
    }
    function playTap(adding){
      if(!context||context.state!=='running'||disposed||doc?.hidden)return;
      const node=makeVoice(false),t=context.currentTime,g=node.gain.gain;
      g.setValueAtTime(.0001,t);g.linearRampToValueAtTime(profile.gain,t+.008);g.exponentialRampToValueAtTime(.0001,t+.095);
      const click=context.createOscillator(),level=context.createGain();click.type='sine';
      click.frequency.setValueAtTime(adding?720:510,t);click.frequency.exponentialRampToValueAtTime(adding?460:300,t+.045);
      level.gain.setValueAtTime(.0001,t);level.gain.linearRampToValueAtTime(.022,t+.004);level.gain.exponentialRampToValueAtTime(.0001,t+.055);
      click.connect(level);level.connect(context.destination);node.sources.push(click);node.nodes.push(click,level);click.start(t);click.stop(t+.065);
      node.cleanup=later(()=>destroy(node),130);intent=null;
    }
    function close(){
      epoch++;pending=null;stop();for(const id of [...timers])cancel(id);
      for(const node of [...active])destroy(node);voice=null;buffer=null;
      const previous=context;context=null;
      if(previous)try{Promise.resolve(previous.close()).catch(()=>{});}catch{}
    }
    const hidden=()=>{if(doc?.hidden)close();};
    function bind(){if(bound)return;bound=true;
      doc?.addEventListener?.('visibilitychange',hidden);host.addEventListener?.('pagehide',close);host.addEventListener?.('blur',close);
    }
    function arm(){
      if(disposed||doc?.hidden)return false;bind();
      try{
        if(!context||context.state==='closed'){
          const Constructor=host.AudioContext||host.webkitAudioContext;if(!Constructor)return false;
          context=new Constructor();buffer=null;
        }
        if(context.state==='running')return true;if(pending)return false;
        const target=context,generation=epoch;
        pending=Promise.resolve(target.resume()).then(()=>{
          if(disposed||generation!==epoch||context!==target||doc?.hidden||target.state!=='running')return;
          const requested=intent;if(!requested||now()-requested.time>180)return;
          if(requested.type==='tap')playTap(requested.adding);else playMotion(requested.force);
        }).catch(()=>{if(generation===epoch&&context===target)close();}).finally(()=>{if(generation===epoch)pending=null;});
      }catch{close();}
      return false;
    }
    function move(force=1){
      if(disposed||doc?.hidden)return;intent={type:'motion',force,time:now()};
      if(context?.state==='running')try{playMotion(force);}catch{close();}
    }
    function tap(adding=true){
      if(disposed||doc?.hidden)return;intent={type:'tap',adding,time:now()};
      if(arm())try{playTap(adding);}catch{close();}
    }
    function dispose(){if(disposed)return;disposed=true;close();
      doc?.removeEventListener?.('visibilitychange',hidden);host.removeEventListener?.('pagehide',close);host.removeEventListener?.('blur',close);
    }
    return {arm,move,tap,stop,dispose,get disposed(){return disposed;}};
  }
  host.PlayableActionAudio={create};
})(typeof window==='undefined'?globalThis:window);
