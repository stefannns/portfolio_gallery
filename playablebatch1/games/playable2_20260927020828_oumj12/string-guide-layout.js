/* No.6 presentation only: follow the actual circle without changing play state. */
(() => {
  const root=document.getElementById('root');
  if(!root)return;
  let board=null,circle=null,frame=0,closed=false;
  const measure=()=>{
    frame=0;
    if(closed||!board?.isConnected||!circle?.isConnected)return;
    const container=board.getBoundingClientRect(),target=circle.getBoundingClientRect();
    if(target.width<=0||target.height<=0)return;
    board.style.setProperty('--string-circle-y',(target.top+target.height/2-container.top)+'px');
    board.style.setProperty('--string-circle-copy-width',target.width*.8+'px');
    board.setAttribute('data-string-guide-aligned','true');
  };
  const schedule=()=>{if(!closed&&!frame)frame=requestAnimationFrame(measure);};
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
  const radius=new MutationObserver(schedule);
  const attach=()=>{
    const nextBoard=root.querySelector('.string-board'),nextCircle=nextBoard?.querySelector('svg>circle');
    if(nextBoard!==board||nextCircle!==circle){
      resize?.disconnect();radius.disconnect();board=nextBoard;circle=nextCircle;
      if(board)resize?.observe(board);
      if(circle){resize?.observe(circle);radius.observe(circle,{attributes:true,attributeFilter:['r','cx','cy']});}
    }
    schedule();
  };
  const content=new MutationObserver(attach);
  content.observe(root,{subtree:true,childList:true});
  const mode=new MutationObserver(schedule);
  mode.observe(document.documentElement,{attributes:true,attributeFilter:['data-ui-batch2-preview']});
  window.addEventListener('resize',schedule);attach();
  window.addEventListener('pagehide',()=>{
    closed=true;if(frame)cancelAnimationFrame(frame);
    resize?.disconnect();radius.disconnect();content.disconnect();mode.disconnect();
    window.removeEventListener('resize',schedule);
  },{once:true});
})();

