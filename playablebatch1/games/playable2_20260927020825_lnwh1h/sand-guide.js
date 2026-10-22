/* Copy lifecycle follows the real sand-removal/reset marker, not incidental taps. */
(() => {
  const root=document.getElementById('root');if(!root)return;
  const style=document.createElement('style');
  style.textContent='.meeting-sand-guide{position:absolute;top:42%;left:30px;right:30px;translate:0 -50%;margin:0;text-align:center;font:600 18px/1.4 var(--font-body,system-ui,sans-serif);color:#713f32;pointer-events:none;z-index:15}.meeting-sand-guide[hidden]{display:none}';
  document.head.append(style);
  function update(){
    const app=[...root.children].find(child=>child.querySelector('canvas'));if(!app)return;
    let guide=app.querySelector('.meeting-sand-guide');
    if(!guide){guide=document.createElement('p');guide.className='meeting-sand-guide';guide.textContent='Drag to dig';app.append(guide);}
    guide.hidden=app.getAttribute('data-sand-guide-used')==='true';
  }
  const observer=new MutationObserver(update);
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-sand-guide-used']});
  update();window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
})();
