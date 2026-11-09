// The points of a parametric shape, as the core computes them (crates/noteful-core/src/shape.rs).
const SIN72 = Math.sin(72 * Math.PI / 180), COS36 = Math.cos(36 * Math.PI / 180);
export const CLOSED_SHAPES = new Set(['rectangle', 'ellipse', 'triangle', 'star']);
export function shapePoints(kind,a,b){
 const [x,y]=a,[u,v]=b;
 if(kind==='rectangle')return [[x,y],[u,y],[u,v],[x,v],[x,y]];
 if(kind==='ellipse')return Array.from({length:65},(_,i)=>[(x+u)/2+Math.abs(u-x)/2*Math.cos(i*Math.PI/32),(y+v)/2+Math.abs(v-y)/2*Math.sin(i*Math.PI/32)]);
 if(kind==='triangle')return [[(x+u)/2,y],[u,v],[x,v],[(x+u)/2,y]];
 if(kind==='star')return Array.from({length:11},(_,i)=>{
  // Outer points on the unit circle, inner ones at the regular pentagram's 0.382; the
  // star's own box (x ±sin 72°, y from -1 to cos 36°) is mapped onto the drag.
  const r=i%2?0.381966:1,t=(-90+36*i)*Math.PI/180,px=r*Math.cos(t),py=r*Math.sin(t);
  return [x+(px+SIN72)/(2*SIN72)*(u-x),y+(py+1)/(COS36+1)*(v-y)];
 });
 if(kind==='arrow'){
  const angle=Math.atan2(v-y,u-x),d=Math.min(24,Math.hypot(u-x,v-y)/3);
  return [a,b,[u-d*Math.cos(angle-.5),v-d*Math.sin(angle-.5)],b,[u-d*Math.cos(angle+.5),v-d*Math.sin(angle+.5)]];
 }
 return [a,b];
}
export function resizedShape(kind,fixed,moving){
 return CLOSED_SHAPES.has(kind)
 ?{kind,start:[Math.min(fixed[0],moving[0]),Math.min(fixed[1],moving[1])],end:[Math.max(fixed[0],moving[0]),Math.max(fixed[1],moving[1])]}
 :{kind,start:fixed,end:moving};
}
