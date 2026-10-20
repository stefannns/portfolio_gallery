import {FilesetResolver,ImageSegmenter} from './vendor/vision_bundle.mjs';
let segmenterPromise;
async function segmenter(){
  if(!segmenterPromise)segmenterPromise=(async()=>{
    const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href);
    return ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/selfie_multiclass.tflite',import.meta.url).href,delegate:'CPU'},runningMode:'IMAGE',outputCategoryMask:true,outputConfidenceMasks:true});
  })();
  return segmenterPromise;
}
// Select one face, not hands or other people. Hair/accessories are restricted to
// the selected face's neighborhood; clothing/body-skin never become head pixels.
function largestFace(mask,w,h){
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let best=[];
  for(let start=0;start<mask.length;start++){
    if(seen[start]||mask[start]!==3)continue;
    let head=0,tail=1;queue[0]=start;seen[start]=1;
    while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;
      for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&!seen[j]&&mask[j]===3){seen[j]=1;queue[tail++]=j;}
    }
    if(tail>best.length)best=Array.from(queue.subarray(0,tail));
  }
  if(best.length<24)throw new Error('No clear face found. Try a close-up portrait.');
  let left=w,right=0,top=h,bottom=0;
  for(const i of best){const x=i%w,y=(i/w)|0;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return {left,right,top,bottom,cx:(left+right)/2,width:right-left+1,height:bottom-top+1};
}
self.onmessage=async({data})=>{
  const {id,bitmap}=data;
  let result;
  try{
    self.postMessage({id,status:'Loading local head cutout…'});
    const task=await segmenter();
    self.postMessage({id,status:'Cutting out your head…'});
    const input=new OffscreenCanvas(bitmap.width,bitmap.height);const ic=input.getContext('2d');ic.drawImage(bitmap,0,0);bitmap.close();
    result=task.segment(input);
    const mask=result.categoryMask.getAsUint8Array(),w=result.categoryMask.width,h=result.categoryMask.height;
    const face=largestFace(mask,w,h);
    const left=Math.max(0,Math.floor(face.left-face.width*.8)),right=Math.min(w-1,Math.ceil(face.right+face.width*.8));
    const top=Math.max(0,Math.floor(face.top-face.height*.9)),bottom=Math.min(h-1,Math.ceil(face.bottom+face.height*.06));
    const small=new OffscreenCanvas(w,h),sc=small.getContext('2d');sc.drawImage(input,0,0,w,h);
    const pixels=sc.getImageData(0,0,w,h),confidence=result.confidenceMasks?.map(m=>m.getAsFloat32Array());
    let minX=w,minY=h,maxX=0,maxY=0,kept=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;let a=0;
      if(x>=left&&x<=right&&y>=top&&y<=bottom){
        const ex=(x-face.cx)/(face.width*1.35),ey=(y-(face.top+face.bottom)/2)/(face.height*1.5);
        if(ex*ex+ey*ey<1.15){
          const p=confidence?confidence[1][i]+confidence[3][i]+confidence[5][i]:(mask[i]===1||mask[i]===3||mask[i]===5?1:0);
          const neckFade=Math.min(1,Math.max(0,(face.bottom+face.height*.06-y)/(face.height*.08)));
          a=Math.min(1,Math.max(0,(p-.18)/.64))*neckFade;
        }
      }
      pixels.data[i*4+3]=Math.round(a*255);
      if(a>.15){kept++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    }
    if(kept<40)throw new Error('The head cutout is empty. Try another portrait.');
    sc.putImageData(pixels,0,0);
    const pad=3;minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(w-1,maxX+pad);maxY=Math.min(h-1,maxY+pad);
    const cw=maxX-minX+1,ch=maxY-minY+1;
    const output=new OffscreenCanvas(cw*2,ch*2);output.getContext('2d').drawImage(small,minX,minY,cw,ch,0,0,cw*2,ch*2);
    const cutout=output.transferToImageBitmap();
    const anchor={x:(face.cx-minX)/cw,y:Math.min(1,(face.bottom-minY)/ch)};
    self.postMessage({id,done:true,bitmap:cutout,anchor,diagnostics:{maskWidth:w,maskHeight:h,keptPixels:kept,faceWidth:face.width,faceHeight:face.height}},[cutout]);
  }catch(error){segmenterPromise=null;self.postMessage({id,error:error.message||'Could not process this photo.'});}
  finally{result?.close();}
};
