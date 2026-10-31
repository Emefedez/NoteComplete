import {matrix,point,inverse,multiply,corners,resizeAdjustment} from './selection-geometry.js';
import {cropMode} from './crop.js';
const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
const svg=(tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;};
const clone=value=>structuredClone(value);
export class SelectionController {
 constructor({call,patch,remove,panel,editable,changed,status}){
  Object.assign(this,{call,patch,remove,panel,editable,changed,status});this.token=0;this.item=null;this.active=null;
  for(const id of ['selectedColor','selectedWidth','selectedW','selectedH','selectedAngle']){
   $(id).onchange=()=>this.properties();$(id).onblur=()=>this.properties();$(id).onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();this.properties();}};
  }
  $('clearSelection').onclick=()=>this.clear();$('cropSelection').onclick=()=>this.startCrop();$('deleteSelection').onclick=async()=>{if(this.item&&this.editable()){const item=this.item;this.clear();if(item.kind==='group'){for(const m of item.members){try{await this.remove(m);}catch{}}}else{await this.remove(item);}}};
 }
 clear(){this.token++;this.cropping?.cancel();this.cancel();this.item=null;this.overlay?.remove();this.overlay=null;$('selectionOptions').hidden=true;this.changed();}
 async selectId(page,id){
  const token=++this.token;
  try{const item=await this.call('selection',{page,itemId:id});if(token===this.token){this.item=item;this.inspect();this.render(this.panel(page));this.changed();}}catch{if(token===this.token)this.clear();}
 }
 selectGroup(page,members,bounds){
  this.token++;
  this.item={
   kind:'group',
   page,
   id:'group:'+Date.now(),
   bounds,
   base_rotation:0,
   base_width:1,
   base_rgba:[0,0,0,1],
   styled:false,
   adjustment:{translation:[0,0],scale:[1,1],rotation:0},
   members
  };
  this.inspect();
  this.render(this.panel(page));
  this.changed();
 }
 inspect(){
  const item=this.item;if(!item)return;const a=item.adjustment;
  if(item.kind==='group'){
   $('selectionOptions').hidden=false;$('selectionKind').textContent=`Group (${item.members.length})`;
   $('selectedStyle').hidden=true;$('cropSelection').hidden=true;
   $('selectedW').value=+(item.bounds[2]*a.scale[0]).toFixed(2);$('selectedW').disabled=false;
   $('selectedH').value=+(item.bounds[3]*a.scale[1]).toFixed(2);$('selectedH').disabled=false;
   $('selectedAngle').value=+(item.base_rotation+a.rotation).toFixed(2);
   return;
  }
  $('selectionOptions').hidden=false;$('selectionKind').textContent={shape:'Shape',ink:'Stroke',image:'Image',text:'Text'}[item.kind];
  $('selectedStyle').hidden=!item.styled;$('cropSelection').hidden=item.kind!=='image'||!item.crop;
  const rgba=a.rgba||item.base_rgba;
  $('selectedColor').value='#'+rgba.slice(0,3).map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');
  $('selectedWidth').value=+(a.width??item.base_width).toFixed(2);
  $('selectedW').value=+(item.bounds[2]*a.scale[0]).toFixed(2);$('selectedW').disabled=item.bounds[2]<1e-6;
  $('selectedH').value=+(item.bounds[3]*a.scale[1]).toFixed(2);$('selectedH').disabled=item.bounds[3]<1e-6;
  $('selectedAngle').value=+(item.base_rotation+a.rotation).toFixed(2);
 }
 async properties(){
  if(!this.item||!this.editable())return;
  const item=this.item,a=clone(item.adjustment);
  if(item.kind==='group'){
   for(let i=0;i<2;i++){const v=Number($(i?'selectedH':'selectedW').value);if(item.bounds[i+2]>1e-6&&v!==+(item.bounds[i+2]*a.scale[i]).toFixed(2))a.scale[i]=v/item.bounds[i+2];}
   if(Number($('selectedAngle').value)!==+(item.base_rotation+a.rotation).toFixed(2))a.rotation=Number($('selectedAngle').value)-item.base_rotation;
   if(JSON.stringify(a)===JSON.stringify(item.adjustment))return;
   await this.commit(a);
   return;
  }
  if(item.styled){
   if(Number($('selectedWidth').value)!==+(a.width??item.base_width).toFixed(2))a.width=Number($('selectedWidth').value);
   const rgba=a.rgba||item.base_rgba,hex='#'+rgba.slice(0,3).map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');
   if($('selectedColor').value!==hex)a.rgba=[...$('selectedColor').value.slice(1).match(/../g).map(c=>parseInt(c,16)/255),rgba[3]];
  }
  for(let i=0;i<2;i++){const v=Number($(i?'selectedH':'selectedW').value);if(item.bounds[i+2]>1e-6&&v!==+(item.bounds[i+2]*a.scale[i]).toFixed(2))a.scale[i]=v/item.bounds[i+2];}
  if(Number($('selectedAngle').value)!==+(item.base_rotation+a.rotation).toFixed(2))a.rotation=Number($('selectedAngle').value)-item.base_rotation;
  if(JSON.stringify(a)===JSON.stringify(item.adjustment))return;
  await this.commit(a);
 }
 async commit(adjustment){
  const item=this.item;if(!item)return;
  $('selectionFields').disabled=true;
  try{
   if(item.kind==='group'){
    const delta=multiply(matrix(item,adjustment),inverse(matrix(item)));
    for(const m of item.members){
     const mAdj=clone(m.adjustment);
     if(adjustment.scale[0]===1&&adjustment.scale[1]===1&&adjustment.rotation===0){
      mAdj.translation=[mAdj.translation[0]+adjustment.translation[0],mAdj.translation[1]+adjustment.translation[1]];
     }else{
      mAdj.translation=[mAdj.translation[0]+delta[4],mAdj.translation[1]+delta[5]];
      mAdj.scale=[mAdj.scale[0]*adjustment.scale[0],mAdj.scale[1]*adjustment.scale[1]];
      mAdj.rotation=(mAdj.rotation+adjustment.rotation);
     }
     await this.patch(m,mAdj);
     m.adjustment=mAdj;
    }
    item.bounds=[item.bounds[0]+adjustment.translation[0],item.bounds[1]+adjustment.translation[1],item.bounds[2]*adjustment.scale[0],item.bounds[3]*adjustment.scale[1]];
    item.adjustment={translation:[0,0],scale:[1,1],rotation:0};
    this.inspect();
   }else{
    const result=await this.patch(item,adjustment);if(result&&this.item?.id===item.id&&this.item?.page===item.page){this.item=result.selection;this.inspect();}
   }
  }
  finally{
   if(item.kind==='group'){
    for(const m of item.members)m.element?.removeAttribute('transform');
   }else{
    this.previewElement?.removeAttribute('transform');this.previewElement=null;
   }
   $('selectionFields').disabled=false;if(this.item){this.inspect();this.render(this.panel(this.item.page));}
  }
 }
 // Crop (images): the frame replaces the selection box until Done or Cancel.
 startCrop(){
  const item=this.item;if(!item||item.kind!=='image'||!this.editable()||this.cropping)return;
  const p=this.panel(item.page);if(!p?.view)return;
  this.overlay?.remove();this.overlay=null;
  this.cropping=cropMode({p,item,coords:(e,q)=>this.coords(e,q),apply:async rect=>{this.cropping=null;$('selectionFields').disabled=true;try{const result=await this.patch(item,null,rect);if(result&&this.item?.id===item.id)this.item=result.selection;}finally{$('selectionFields').disabled=false;if(this.item){this.inspect();this.render(this.panel(this.item.page));}}},done:()=>{this.cropping=null;if(this.item)this.render(p);}});
  if(!this.cropping)this.status('This image cannot be cropped here.',true);
 }
 render(p){
  if(this.cropping)return;
  if(this.item?.page!==p?.index||!p?.view)return;
  this.overlay?.remove();this.overlay=null;
  if(this.item.kind!=='group'){
   const el=p.render?.querySelector(`[data-item="${this.item.id}"]`);if(!el){this.clear();return;}
  }
  const item=this.item,points=corners(item),unit=p.size[0]/p.el.getBoundingClientRect().width;
  const overlay=svg('svg',{viewBox:`0 0 ${p.size.join(' ')}`,class:'selection-overlay', 'aria-label':item.kind==='group'?'Selected group':'Selected item'});
  const polygon=svg('polygon',{points:points.map(p=>p.join(',')).join(' '),fill:'#1683ed0d',stroke:'#1683ed','stroke-width':unit,'stroke-dasharray':`${4*unit} ${3*unit}`,'data-selection-handle':'move'});
  polygon.style.pointerEvents='all';polygon.style.cursor='move';
  overlay.append(polygon);
  const angle=(item.base_rotation+item.adjustment.rotation)*Math.PI/180;
  const top=[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2],rotate=[top[0]+Math.sin(angle)*30*unit,top[1]-Math.cos(angle)*30*unit];
  overlay.append(svg('line',{x1:top[0],y1:top[1],x2:rotate[0],y2:rotate[1],stroke:'#1683ed','stroke-width':unit}));
  for(const [i,at] of [...points,rotate].entries()){
   const handle=svg('circle',{cx:at[0],cy:at[1],r:8*unit,fill:i===4?'#1683ed':'white',stroke:'#1683ed','stroke-width':1.5*unit,tabindex:0,role:'button','data-selection-handle':i,'aria-label':i===4?'Rotate item':'Corner '+(i+1)});
   handle.style.pointerEvents='all';handle.style.cursor=i===4?'grab':['nwse-resize','nesw-resize','nwse-resize','nesw-resize'][i];
   handle.onkeydown=event=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta||!this.editable())return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;const a=i===4?{...clone(item.adjustment),rotation:item.adjustment.rotation+(delta[0]||delta[1])*step}:resizeAdjustment(item,i,[at[0]+delta[0]*step,at[1]+delta[1]*step]);this.commit(a);};
   overlay.append(handle);
  }
  p.el.append(overlay);this.overlay=overlay;
 }
 coords(event,p){const r=p.el.getBoundingClientRect();return [(event.clientX-r.left)/r.width*p.size[0],(event.clientY-r.top)/r.height*p.size[1]];}
 down(event,p,tool){
  if(this.cropping)return true;
  // Double-click a selected image to crop it.
  const last=this.lastDown;this.lastDown={time:event.timeStamp,x:event.clientX,y:event.clientY};
  if(last&&event.timeStamp-last.time<450&&Math.hypot(event.clientX-last.x,event.clientY-last.y)<8&&tool==='select'&&this.item?.kind==='image'&&this.item.page===p.index&&!event.target.closest('[data-selection-handle]')){event.preventDefault();this.lastDown=null;this.startCrop();return true;}
  const handle=event.target.closest('[data-selection-handle]');
  if(!handle&&tool!=='select')return false;
  if(!this.editable()||!p.view||event.button!==0)return true;
  event.preventDefault();p.el.setPointerCapture(event.pointerId);
  const at=this.coords(event,p),g={id:event.pointerId,p,start:at,current:at,startClient:[event.clientX,event.clientY],currentClient:[event.clientX,event.clientY],ended:false,mode:handle?handle.dataset.selectionHandle==='move'?'move':Number(handle.dataset.selectionHandle):'pick'};this.active=g;
  if(handle&&this.item?.page===p.index){g.item=clone(this.item);g.mode=handle.dataset.selectionHandle==='move'?'move':Number(handle.dataset.selectionHandle);this.begin(g);}
  else{
   const token=++this.token;
   this.call('pick',{page:p.index,x:at[0],y:at[1],tolerance:8*p.size[0]/p.el.getBoundingClientRect().width}).then(item=>{
    if(token!==this.token||this.active!==g)return;
    if(!item){this.clear();return;}
    this.item=item;g.item=clone(item);g.mode='move';this.inspect();this.changed();this.render(p);this.begin(g);
    if(g.ended)this.finish(g);
   }).catch(e=>{if(token===this.token){this.status(e.message,true);this.clear();}});
  }return true;
 }
 begin(g){
  g.start=this.coords({clientX:g.startClient[0],clientY:g.startClient[1]},g.p);
  g.current=this.coords({clientX:g.currentClient[0],clientY:g.currentClient[1]},g.p);
  g.original=matrix(g.item);
  if(g.item.kind==='group'){
   for(const m of g.item.members){
    m.element=g.p.render?.querySelector(`[data-item="${m.id}"]`);
    m.original=matrix(m);
   }
  }else{
   g.element=g.p.render?.querySelector(`[data-item="${g.item.id}"]`);
   this.previewElement=g.element;
  }
  this.preview(g);
 }
 move(event){const g=this.active;if(!g||g.id!==event.pointerId)return false;g.currentClient=[event.clientX,event.clientY];g.current=this.coords(event,g.p);if(g.item&&!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;if(this.active===g)this.preview(g);});return true;}
 adjustment(g){
  const a=clone(g.item.adjustment);
  if(g.mode==='move'){a.translation=[a.translation[0]+g.current[0]-g.start[0],a.translation[1]+g.current[1]-g.start[1]];return a;}
  if(g.mode===4){const [x,y,w,h]=g.item.bounds,c=[x+w/2+a.translation[0],y+h/2+a.translation[1]];a.rotation+=(Math.atan2(g.current[1]-c[1],g.current[0]-c[0])-Math.atan2(g.start[1]-c[1],g.start[0]-c[0]))*180/Math.PI;return a;}
  return resizeAdjustment(g.item,g.mode,g.current);
 }
 preview(g){
  const a=this.adjustment(g);
  if(g.item.kind==='group'){
   const delta=multiply(matrix(g.item,a),inverse(g.original));
   for(const m of g.item.members){
    if(m.element){
     const mDelta=multiply(delta,m.original);
     const finalM=multiply(mDelta,inverse(m.original));
     m.element.setAttribute('transform',`matrix(${finalM.join(' ')})`);
    }
   }
   this.overlay?.setAttribute('style',`transform-origin:0 0;`);
   const cs=corners(g.item,a);const polygon=this.overlay?.querySelector('polygon');if(polygon)polygon.setAttribute('points',cs.map(p=>p.join(',')).join(' '));
   this.overlay?.querySelectorAll('circle,line').forEach(el=>el.style.visibility='hidden');
   return;
  }
  if(!g.element)return;const delta=multiply(matrix(g.item,a),inverse(g.original));
  g.element.setAttribute('transform',`matrix(${delta.join(' ')})`);
  // The bounding overlay shares the exact transform; no geometry rebuilding on pointermove.
  this.overlay?.setAttribute('style',`transform-origin:0 0;`);
  const cs=corners(g.item,a);const polygon=this.overlay?.querySelector('polygon');if(polygon)polygon.setAttribute('points',cs.map(p=>p.join(',')).join(' '));
  this.overlay?.querySelectorAll('circle,line').forEach(el=>el.style.visibility='hidden');
 }
 up(event){const g=this.active;if(!g||g.id!==event.pointerId)return false;g.currentClient=[event.clientX,event.clientY];g.current=this.coords(event,g.p);g.ended=true;if(g.item)this.finish(g);return true;}
 finish(g){
  this.active=null;cancelAnimationFrame(this.frame);this.frame=0;
  if(g.p.el.hasPointerCapture(g.id))g.p.el.releasePointerCapture(g.id);
  if(Math.hypot(g.currentClient[0]-g.startClient[0],g.currentClient[1]-g.startClient[1])<3){
   if(g.item.kind==='group'){
    for(const m of g.item.members)m.element?.removeAttribute('transform');
   }else{
    g.element?.removeAttribute('transform');this.previewElement=null;
   }
   this.render(g.p);return;
  }
  this.commit(this.adjustment(g));
 }
 lostCapture(p){if(this.active?.p===p&&!this.active.ended)this.cancel();}
 cancel(){
  const g=this.active;this.active=null;cancelAnimationFrame(this.frame);this.frame=0;
  if(g?.item?.kind==='group'){
   for(const m of g.item.members)m.element?.removeAttribute('transform');
  }else{
   this.previewElement?.removeAttribute('transform');this.previewElement=null;
  }
  if(g?.p.el.hasPointerCapture(g.id))g.p.el.releasePointerCapture(g.id);
  if(g&&this.item)this.render(g.p);
 }
}
