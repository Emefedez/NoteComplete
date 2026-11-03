import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {matrix,point,inverse,multiply,corners,resizeAdjustment,regionSweep} from './selection-geometry.js';
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${v} != ${b[i]}`));
const item={bounds:[10,20,200,120],base_rotation:25,adjustment:{translation:[40,15],scale:[1.4,.8],rotation:35,width:null,rgba:null}};
test('transform and inverse preserve points and incremental preview matches final geometry',()=>{
 const before=matrix(item),after=matrix(item,{...item.adjustment,rotation:60,translation:[90,-10]});
 close(point(inverse(before),point(before,[22,35])),[22,35]);
 close(point(multiply(after,inverse(before)),point(before,[22,35])),point(after,[22,35]));
});
test('resizing a rotated object keeps its opposite corner fixed without accumulating transforms',()=>{
 const old=corners(item),moving=[old[2][0]+30,old[2][1]+50];
 const a=resizeAdjustment(item,2,moving),next=corners(item,a);
 close(next[0],old[0]);close(next[2],moving);
 assert.deepEqual(item.adjustment.scale,[1.4,.8]);
});
test('the region eraser reaches every point of the region and barely past it',()=>{
 for(const rect of [[10,20,300,40],[0,0,50,700],[5,5,3,2],[100,100,800,600]]){
  const {points,radius}=regionSweep(rect),[x,y,w,h]=rect;
  assert.ok(radius>=.1&&radius<=100&&radius<=Math.max(.5,Math.min(w,h)/4),`radius ${radius}`);
  const dist=([px,py])=>Math.min(...points.slice(1).map((b,i)=>{const a=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(a[0]+t*dx-px,a[1]+t*dy-py);}),...points.map(a=>Math.hypot(a[0]-px,a[1]-py)));
  for(let i=0;i<=20;i++)for(let j=0;j<=20;j++)assert.ok(dist([x+w*i/20,y+h*j/20])<=radius+1e-9,`(${i},${j}) of ${rect}`);
  for(const q of points)assert.ok(q[0]>=x&&q[0]<=x+w&&q[1]>=y&&q[1]<=y+h,'the path stays inside');
 }
});
