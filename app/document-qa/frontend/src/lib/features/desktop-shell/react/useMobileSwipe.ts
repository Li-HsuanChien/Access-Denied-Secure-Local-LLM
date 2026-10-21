import { useEffect, useRef, useState } from 'react';
/** Port of the pinned MobileSwipePanel's touch arbitration and settling thresholds. */
export function useMobileSwipe(enabled: boolean, open: boolean, width: number, onOpenChange: (open: boolean) => void) {
 const [progress, setProgress] = useState(open ? 1 : 0);
 const [mounted, setMounted] = useState(open);
 const [settling, setSettling] = useState(false);
 const values = useRef({enabled,open,width,onOpenChange,progress}); values.current = {enabled,open,width,onOpenChange,progress};
 useEffect(() => {
  if (!enabled) { setMounted(false); setProgress(open ? 1 : 0); setSettling(false); return; }
  if(open) setMounted(true);
  const frame=requestAnimationFrame(()=>{setSettling(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);setProgress(open?1:0);});
  const timer=setTimeout(()=>setSettling(false),210);
  return ()=>{cancelAnimationFrame(frame);clearTimeout(timer);};
 },[enabled,open]);
 useEffect(()=>{
  let active=false,locked=false,startX=0,startY=0,startProgress=0,lastX=0,lastTime=0,velocity=0,direction='';
  const lock=(value:boolean)=>{document.documentElement.classList.toggle('mobile-swipe-panel-active',value);document.body.classList.toggle('mobile-swipe-panel-active',value);};
  const selection=()=>{const s=window.getSelection();return !!s&&!s.isCollapsed;};
  const reset=()=>{active=false;locked=false;lock(false);};
  const animate=(next:boolean)=>{setSettling(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);setProgress(next?1:0);};
  const cancel=()=>{reset();animate(values.current.open);};
  const start=(event:TouchEvent)=>{
   const {enabled,open,progress}=values.current;
   if(!enabled||event.touches.length!==1||selection()||(event.target instanceof Element&&event.target.closest('input, textarea, select, [role="dialog"], [role="menu"], [contenteditable="true"], [data-sidebar-no-gesture]')))return;
   const touch=event.touches[0]; if(!open&&touch.clientX<16)return;
   direction=open?'close':'open';startProgress=open?(progress||1):0;if(!open){setMounted(true);setProgress(0);}
   setSettling(false);active=true;locked=false;startX=lastX=touch.clientX;startY=touch.clientY;lastTime=event.timeStamp;velocity=0;
  };
  const move=(event:TouchEvent)=>{
   if(!active||event.touches.length!==1)return;
   const touch=event.touches[0],dx=touch.clientX-startX,dy=touch.clientY-startY,ax=Math.abs(dx),ay=Math.abs(dy);
   if(!locked){
    if(selection()){cancel();return;}
    if((direction==='open'&&dx>0)||(direction==='close'&&dx<0))setProgress(Math.max(0,Math.min(1,startProgress+dx/values.current.width)));
    if(ax<8&&ay<8)return;
    let target=event.target instanceof Element?event.target:null;
    while(target&&target!==document.documentElement&&target!==document.body){const node=target as HTMLElement;if(/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowX)&&node.scrollWidth>node.clientWidth+1&&(dx>0?node.scrollLeft>0:node.scrollLeft<node.scrollWidth-node.clientWidth-1)){cancel();return;}target=target.parentElement;}
    if(ay>ax||ax<ay*1.2){cancel();return;}locked=true;lock(true);
   }
   event.preventDefault();velocity=(touch.clientX-lastX)/Math.max(1,event.timeStamp-lastTime);lastX=touch.clientX;lastTime=event.timeStamp;
   setProgress(Math.max(0,Math.min(1,startProgress+dx/values.current.width)));
  };
  const end=()=>{if(!active)return;if(!locked){cancel();return;}let next=values.current.progress>(direction==='open'?0.35:0.65);if(velocity>0.55)next=true;else if(velocity< -0.55)next=false;reset();animate(next);values.current.onOpenChange(next);};
  window.addEventListener('touchstart',start,{passive:true});window.addEventListener('touchmove',move,{passive:false});window.addEventListener('touchend',end);window.addEventListener('touchcancel',cancel);
  return()=>{window.removeEventListener('touchstart',start);window.removeEventListener('touchmove',move);window.removeEventListener('touchend',end);window.removeEventListener('touchcancel',cancel);lock(false);};
 },[]);
 return {visible:open||(enabled&&mounted),progress:enabled?progress:1,transition:settling?'210ms cubic-bezier(0.22, 1, 0.36, 1)':'none'};
}
