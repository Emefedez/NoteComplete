export function matrix(item, adjustment=item.adjustment) {
 const [x,y,w,h]=item.bounds,cx=x+w/2,cy=y+h/2;
 const old=item.base_rotation*Math.PI/180,angle=old+adjustment.rotation*Math.PI/180;
 const [sx,sy]=adjustment.scale,[tx,ty]=adjustment.translation;
 const c=Math.cos(angle),s=Math.sin(angle),oc=Math.cos(old),os=Math.sin(old);
 const a=c*sx*oc+s*sy*os,b=s*sx*oc-c*sy*os,cc=c*sx*os-s*sy*oc,d=s*sx*os+c*sy*oc;
 return [a,b,cc,d,cx+tx-a*cx-cc*cy,cy+ty-b*cx-d*cy];
}
export function point(m,[x,y]){return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
export function inverse([a,b,c,d,e,f]){const det=a*d-b*c;return [d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];}
export function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function corners(item,a=item.adjustment){
 const [x,y,w,h]=item.bounds,angle=(item.base_rotation+a.rotation)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const cx=x+w/2+a.translation[0],cy=y+h/2+a.translation[1],hw=Math.max(w,1)*a.scale[0]/2,hh=Math.max(h,1)*a.scale[1]/2;
 return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y])=>[cx+c*x-s*y,cy+s*x+c*y]);
}
export function resizeAdjustment(item,index,moving){
 const a=structuredClone(item.adjustment),fixed=corners(item)[(index+2)%4];
 const angle=(item.base_rotation+a.rotation)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const dx=moving[0]-fixed[0],dy=moving[1]-fixed[1],signX=[-1,1,1,-1][index],signY=[-1,-1,1,1][index];
 const w=Math.max(item.bounds[2],1),h=Math.max(item.bounds[3],1);
 a.scale=[Math.max(.001,Math.min(1000,(dx*c+dy*s)*signX/w)),Math.max(.001,Math.min(1000,(-dx*s+dy*c)*signY/h))];
 const lx=signX*w*a.scale[0]/2,ly=signY*h*a.scale[1]/2;
 a.translation=[fixed[0]+c*lx-s*ly-item.bounds[0]-item.bounds[2]/2,fixed[1]+s*lx+c*ly-item.bounds[1]-item.bounds[3]/2];
 return a;
}
// Erase in a grabbed region (app.js): the eraser's path through the whole region, row by row.
// Rows are two radii apart, so every stroke that enters the region is touched; the radius is
// small next to the region, so strokes outside it are left alone.
export function regionSweep([x, y, w, h]) {
  const r = Math.min(100, Math.max(0.5, Math.min(w, h) / 16, h / 400));
  const rows = Math.max(1, Math.ceil(h / (2 * r)));
  const points = [];
  for (let i = 0; i < rows; i++) {
    const ry = rows === 1 ? y + h / 2 : y + r + (i * (h - 2 * r)) / (rows - 1);
    const ends = [x, x + w];
    if (i % 2) ends.reverse();
    for (const ex of ends) points.push([ex, ry]);
  }
  return { points, radius: r };
}
