/* No.19: notify the existing renderer when its flex playfield changes size. */
(() => {
  const root=document.getElementById('root');
  if(!root)return;
  let board=null,frame=0,closed=false,attempts=0;
  const sync=()=>{
    frame=0;
    if(closed||!board?.isConnected)return;
    const canvas=board.querySelector('canvas');
    if(!canvas)return;
    const target=board.getBoundingClientRect(),current=canvas.getBoundingClientRect();
    if(Math.abs(target.width-current.width)<.75&&Math.abs(target.height-current.height)<.75){attempts=0;return;}
    // This package already handles resize by fitting its bitmap and static
    // walls. Reuse that layout signal; do not recreate bodies or play input.
    window.dispatchEvent(new Event('resize'));
    if(++attempts<3)schedule();
  };
  const schedule=()=>{if(!closed&&!frame)frame=requestAnimationFrame(sync);};
  const resized=typeof ResizeObserver==='function'?new ResizeObserver(()=>{attempts=0;schedule();}):null;
  const attach=()=>{
    const next=root.querySelector('.meeting-cube-board');
    if(next!==board){resized?.disconnect();board=next;if(board)resized?.observe(board);}
    attempts=0;schedule();
  };
  const content=new MutationObserver(attach);
  content.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  attach();
  window.addEventListener('pagehide',()=>{
    closed=true;if(frame)cancelAnimationFrame(frame);
    resized?.disconnect();content.disconnect();
  },{once:true});
})();
