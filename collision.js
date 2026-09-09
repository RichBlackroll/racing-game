// Circle car collider, obstacle normals, swept substeps and elastic reflection.
export function moveWithBounces(position, velocity, dt, obstacles, limit=280, radius=1.12) {
 let x=position.x,z=position.z,vx=velocity.x,vz=velocity.z,hits=0;
 const steps=Math.max(1,Math.ceil(Math.hypot(vx,vz)*dt/.4));
 function reflect(nx,nz){const into=vx*nx+vz*nz;if(into<0){vx-=1.82*into*nx;vz-=1.82*into*nz;hits++;}}
 for(let i=0;i<steps;i++){
  x+=vx*dt/steps;z+=vz*dt/steps;
  for(const o of obstacles){
   let nx,nz,depth;
   if(o.hx!==undefined){
    const qx=Math.max(o.x-o.hx,Math.min(o.x+o.hx,x)),qz=Math.max(o.z-o.hz,Math.min(o.z+o.hz,z));
    let dx=x-qx,dz=z-qz,d=Math.hypot(dx,dz);
    if(d>=radius)continue;
    if(d>1e-8){nx=dx/d;nz=dz/d;depth=radius-d;}
    else{let ax=o.hx-Math.abs(x-o.x),az=o.hz-Math.abs(z-o.z);if(ax<az){nx=x>=o.x?1:-1;nz=0;depth=ax+radius;}else{nx=0;nz=z>=o.z?1:-1;depth=az+radius;}}
   }else{let dx=x-o.x,dz=z-o.z,d=Math.hypot(dx,dz),r=o.r+radius;if(d>=r)continue;if(d<1e-8){const v=Math.hypot(vx,vz)||1;nx=-vx/v;nz=-vz/v;if(!nx&&!nz)nx=1;}else{nx=dx/d;nz=dz/d;}depth=r-d;}
   x+=nx*(depth+.002);z+=nz*(depth+.002);reflect(nx,nz);
  }
  if(x>limit-radius){x=limit-radius;reflect(-1,0)}if(x<-limit+radius){x=-limit+radius;reflect(1,0)}
  if(z>limit-radius){z=limit-radius;reflect(0,-1)}if(z<-limit+radius){z=-limit+radius;reflect(0,1)}
 }
 return {x,z,vx,vz,hits};
}
