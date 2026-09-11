import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { inClearing } from "./landmarks.js";

export function stadiumRoute(route) {
  route.forEach((p,i) => {
    const section = Math.floor(i/60), t = (i%60)/60;
    if (section === 0) p.set(-90+180*t,0.025,100);
    else if (section === 1) p.set(90+Math.sin(t*Math.PI)*100,0.025,Math.cos(t*Math.PI)*100);
    else if (section === 2) p.set(90-180*t,0.025,-100);
    else p.set(-90-Math.sin(t*Math.PI)*100,0.025,-Math.cos(t*Math.PI)*100);
  });
}

export function createRampCourse(scene,route,moon) {
  const ramps = [[-280/3,140],[280/3,-140]].map(([x,z]) => {
    // Keep the original ramp feet fixed even when lap sampling or indexing changes.
    const i=route.findIndex((p,index) => {
      const next=route[(index+1)%route.length];
      return Math.abs(p.z-z)<1e-6 && Math.abs(next.z-z)<1e-6 && (p.x-x)*(next.x-x)<=0;
    });
    if(i<0) throw new RangeError(`Missing flat ramp runway at ${x}, ${z}`);
    const p=route[i], next=route[(i+1)%route.length];
    return {x,z,heading:Math.atan2(next.x-p.x,next.z-p.z),width:9.5,length:18,height:moon?2.4:3};
  });
  const topMaterial = new THREE.MeshStandardMaterial({color:moon?0x8ba8b8:0x1c8992,roughness:0.7,side:THREE.DoubleSide});
  const sideMaterial = new THREE.MeshStandardMaterial({color:moon?0xd2d5d9:0xeeeeea,roughness:0.8,side:THREE.DoubleSide});
  const edgeMaterial = new THREE.MeshStandardMaterial({color:moon?0xffcc4a:0xff6653,roughness:0.7});
  ramps.forEach(ramp => {
    const group=new THREE.Group(); group.position.set(ramp.x,0.075,ramp.z);group.rotation.y=ramp.heading;scene.add(group);
    const w=ramp.width/2,l=ramp.length,h=ramp.height;
    const vertices=[[-w,0,0],[w,0,0],[-w,0,l],[w,0,l],[-w,h,l],[w,h,l]];
    const make=(triangles,material)=>{
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flatMap(i=>vertices[i]),3));g.computeVertexNormals();
      const mesh=new THREE.Mesh(g,material);group.add(mesh);return mesh;
    };
    make([0,4,5,0,5,1],topMaterial);
    make([0,2,4,1,5,3,2,3,5,2,5,4],sideMaterial);
    const angle=Math.atan2(h,l), slopeLength=Math.hypot(l,h);
    for(const x of [-w+0.13,w-0.13]) {
      const edge=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.12,slopeLength),edgeMaterial);
      edge.position.set(x,h/2+0.055,l/2);edge.rotation.x=-angle;group.add(edge);
    }
    // Repeated chevrons make the uphill direction visible without reading.
    const marks=[];
    for(const z of [4,8,12]) for(const side of [-1,1]) {
      const bar=new THREE.BoxGeometry(0.16,0.025,2.3);
      const object=new THREE.Object3D();object.position.set(side*0.72,h*z/l+0.08,z);object.rotation.set(-angle,-side*0.7,0);object.updateMatrix();
      marks.push(bar.applyMatrix4(object.matrix));
    }
    group.add(new THREE.Mesh(mergeGeometries(marks),new THREE.MeshBasicMaterial({color:0xffffff})));
    marks.forEach(g=>g.dispose());
    for(const x of [-6,6]) {
      const post=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,5,8),sideMaterial);post.position.set(x,2.5,0);group.add(post);
      const flag=new THREE.Mesh(new THREE.PlaneGeometry(2,1),new THREE.MeshBasicMaterial({color:moon?0xffcc4a:0xff6653,side:THREE.DoubleSide}));flag.position.set(x+0.9,4.3,0);group.add(flag);
    }
  });
  return ramps;
}

export function createLevelScenery(scene,moon,roadDist,obstacles,terrain,clearings = []) {
  let seed=77;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const heightAt=(x,z)=>terrain?.heightAt(x,z)??0;
  if(!moon) {
    scene.background=new THREE.Color(0xb4dce9);if(scene.fog)scene.fog.color.set(0xb4dce9);
    const standMaterial=new THREE.MeshStandardMaterial({color:0x65797d,roughness:0.85});
    const seatMaterial=new THREE.MeshStandardMaterial({color:0xf2c84b,roughness:0.8});
    for(const side of [-1,1]) for(let row=0;row<4;row++) {
      const platform=new THREE.Mesh(new THREE.BoxGeometry(65,0.4,2.6),row%2?seatMaterial:standMaterial);
      platform.position.set(10,row*0.85+0.3,side*(118+row*2.7));scene.add(platform);
    }
    return;
  }
  scene.background=new THREE.Color(0x020308);scene.fog=null;scene.environment=null;
  const starCanvas=document.createElement('canvas');starCanvas.width=2048;starCanvas.height=1024;
  const skyContext=starCanvas.getContext('2d');skyContext.fillStyle='#020308';skyContext.fillRect(0,0,2048,1024);
  for(let i=0;i<1500;i++) {const v=130+Math.floor(random()*125);skyContext.fillStyle='rgb('+v+','+v+',255)';const size=random()<0.06?2:1;skyContext.fillRect(random()*2048,random()*1024,size,size);}
  const skyTexture=new THREE.CanvasTexture(starCanvas);skyTexture.mapping=THREE.EquirectangularReflectionMapping;skyTexture.colorSpace=THREE.SRGBColorSpace;
  scene.background=skyTexture;scene.backgroundIntensity=1;
  const rockMaterial=new THREE.MeshStandardMaterial({color:0x898d96,roughness:1});
  const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),rockMaterial,70);
  const craters=new THREE.InstancedMesh(new THREE.TorusGeometry(1,0.14,6,24),new THREE.MeshStandardMaterial({color:0xb2b3b9,roughness:1}),35);
  const dummy=new THREE.Object3D();
  let placed=0;
  while(placed<70) {
    const x=(random()-0.5)*780,z=(random()-0.5)*780;
    if(roadDist(x,z)<18 || inClearing(clearings,x,z,12)) continue;
    const size=1+random()*3,y=heightAt(x,z);
    obstacles.push({x,y,z,r:size*0.8,height:size*0.75});
    dummy.position.set(x,y+size*0.22,z);dummy.scale.set(size,size*0.45,size);dummy.rotation.set(0,random()*6,0);dummy.updateMatrix();rocks.setMatrixAt(placed,dummy.matrix);
    if(placed<35) {dummy.position.set(x,y+0.13,z);dummy.scale.setScalar(3+random()*5);dummy.rotation.set(Math.PI/2,0,0);dummy.updateMatrix();craters.setMatrixAt(placed,dummy.matrix);}
    placed++;
  }
  scene.add(rocks,craters);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const c=canvas.getContext('2d');c.fillStyle='#167bc1';c.fillRect(0,0,512,256);
  const continents=[[[38,38],[94,23],[143,55],[127,88],[99,99],[80,79],[61,83]],[[117,101],[155,122],[147,176],[124,213],[106,162]],[[241,51],[275,41],[301,68],[288,85],[299,116],[275,172],[247,137],[231,88]],[[285,43],[346,26],[421,39],[457,66],[410,107],[355,87],[329,111]],[[397,151],[439,143],[461,171],[426,186],[399,174]]];
  c.fillStyle='#78ad79';continents.forEach(points=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();});
  c.fillStyle='#e2f3ff';c.fillRect(0,0,512,10);c.fillRect(0,245,512,11);
  c.strokeStyle='#ffffff99';c.lineWidth=5;
  for(let i=0;i<16;i++){c.beginPath();c.ellipse(random()*512,25+random()*200,16+random()*42,4,random(),0,Math.PI*1.5);c.stroke();}
  const earthTexture=new THREE.CanvasTexture(canvas);earthTexture.colorSpace=THREE.SRGBColorSpace;
  const earth=new THREE.Mesh(new THREE.SphereGeometry(20,40,24),new THREE.MeshStandardMaterial({map:earthTexture,roughness:1,emissive:0x07354b,emissiveIntensity:0.2,fog:false}));
  // Earth stays a world-space sky landmark, not a terrain-grounded prop.
  earth.userData.celestial = true;
  earth.position.set(180,terrain?105:25,145);earth.rotation.z=0.25;scene.add(earth);
  const silver=new THREE.MeshStandardMaterial({color:0xe7eaf0,roughness:0.5,metalness:0.25});
  const solar=new THREE.MeshStandardMaterial({color:0x246aba,roughness:0.35,metalness:0.3,side:THREE.DoubleSide});
  for(const x of [-38,-8,22]) {
    const dome=new THREE.Mesh(new THREE.SphereGeometry(5,20,12,0,Math.PI*2,0,Math.PI/2),silver);dome.position.set(x,heightAt(x,65),65);scene.add(dome);
    const panel=new THREE.Mesh(new THREE.BoxGeometry(9,0.15,4),solar);panel.position.set(x,heightAt(x,53)+3,53);panel.rotation.x=-0.35;scene.add(panel);
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.2,3,8),silver);mast.position.set(x,heightAt(x,53)+1.5,53);scene.add(mast);
  }
  // Cheese boulders and crater holes: the Moon is made of cheese, after all.
  const cheeseMaterial=new THREE.MeshStandardMaterial({color:0xf4e489,roughness:0.55});
  const holeMaterial=new THREE.MeshStandardMaterial({color:0x7a5a26,roughness:1});
  const cheese=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),cheeseMaterial,16);
  const cheeseHoles=new THREE.InstancedMesh(new THREE.TorusGeometry(1,0.15,6,16),holeMaterial,16);
  let cheesePlaced=0;
  while(cheesePlaced<16) {
    const x=(random()-0.5)*760,z=(random()-0.5)*760;
    if(roadDist(x,z)<22 || inClearing(clearings,x,z,5)) continue;
    const s=1.4+random()*1.8,y=heightAt(x,z);
    dummy.position.set(x,y+s*0.4,z);dummy.scale.set(s,s*0.8,s);dummy.rotation.set(0,random()*6,0);dummy.updateMatrix();
    cheese.setMatrixAt(cheesePlaced,dummy.matrix);
    dummy.position.set(x,y+s*0.78,z);dummy.scale.set(s*0.75,s*0.45,s*0.75);dummy.rotation.set(Math.PI/2,random()*6,0);dummy.updateMatrix();
    cheeseHoles.setMatrixAt(cheesePlaced,dummy.matrix);
    cheesePlaced++;
  }
  scene.add(cheese,cheeseHoles);
  // A tiny astronaut friend waves a flag beside the base.
  const astro=new THREE.Group();astro.position.set(8,heightAt(8,70),70);
  const suit=new THREE.MeshStandardMaterial({color:0xf2f4f6,roughness:0.5,metalness:0.06});
  const visor=new THREE.MeshStandardMaterial({color:0x1f5c8c,metalness:0.55,roughness:0.3});
  const flagMaterial=new THREE.MeshStandardMaterial({color:0xdd6f9c,roughness:0.7,side:THREE.DoubleSide});
  const flagSilver=new THREE.MeshStandardMaterial({color:0xd8dbe0,metalness:0.7,roughness:0.3});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.16,0.28,6,10),suit);body.position.set(0,0.58,0);astro.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.2,12,10),suit);head.position.set(0,1.0,0);astro.add(head);
  const face=new THREE.Mesh(new THREE.SphereGeometry(0.16,10,8),visor);face.position.set(0.02,1.04,0.17);face.scale.set(1,0.7,0.7);astro.add(face);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,1.5,6),flagSilver);pole.position.set(0.6,0.75,0);astro.add(pole);
  const flag=new THREE.Mesh(new THREE.PlaneGeometry(0.7,0.42),flagMaterial);flag.position.set(0.6,1.28,0);flag.rotation.y=0.35;astro.add(flag);
  scene.add(astro);
}

// One instanced mesh with room for `count` identical objects.
function carpet(scene,geometry,material,count) {
  const mesh=new THREE.InstancedMesh(geometry,material,count);
  mesh.frustumCulled=false;
  scene.add(mesh);
  return mesh;
}

export function decorateForest(scene,roadDist) {
  let seed=13579;
  const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const dummy=new THREE.Object3D();
  const flowerColors=[0xff5f7a,0xffc94d,0xf06ff0,0x4aa6ff];
  const blooms=flowerColors.map(c=>carpet(scene,new THREE.SphereGeometry(1,7,5),new THREE.MeshStandardMaterial({color:c,roughness:0.85}),40));
  const centers=carpet(scene,new THREE.SphereGeometry(1,5,4),new THREE.MeshStandardMaterial({color:0xffe98a,roughness:0.7}),160);
  const stems=carpet(scene,new THREE.CylinderGeometry(0.5,0.5,1,5),new THREE.MeshStandardMaterial({color:0x3f7a2e,roughness:0.95}),160);
  for(let f=0;f<160;f++) {
    let x,z,tries=0;
    do{x=(rnd()-0.5)*300;z=(rnd()-0.5)*300;}while(roadDist(x,z)<6.2&&++tries<40);
    const h=0.28+rnd()*0.5,s=0.09+rnd()*0.1;
    dummy.position.set(x,h/2,z);dummy.scale.set(0.04,h,0.04);dummy.rotation.set(0,rnd()*6.28,0);dummy.updateMatrix();
    stems.setMatrixAt(f,dummy.matrix);
    dummy.position.set(x,h+s*0.7,z);dummy.rotation.set(rnd()*6.28,rnd()*6.28,0);dummy.scale.set(s,s*0.8,s);dummy.updateMatrix();
    blooms[f%4].setMatrixAt(Math.floor(f/4),dummy.matrix);
    dummy.position.set(x,h+s*1.4,z);dummy.scale.setScalar(s*0.32);dummy.rotation.set(0,0,0);dummy.updateMatrix();
    centers.setMatrixAt(f,dummy.matrix);
  }
  // Red-capped mushrooms with pale dots.
  const caps=carpet(scene,new THREE.SphereGeometry(1,8,5),new THREE.MeshStandardMaterial({color:0xd8403a,roughness:0.8}),44);
  const dots=carpet(scene,new THREE.SphereGeometry(1,5,4),new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.9}),88);
  const stalks=carpet(scene,new THREE.CylinderGeometry(0.5,0.5,1,5),new THREE.MeshStandardMaterial({color:0xf3e9d4,roughness:0.9}),44);
  for(let m=0;m<44;m++) {
    let x,z,tries=0;
    do{x=(rnd()-0.5)*300;z=(rnd()-0.5)*300;}while(roadDist(x,z)<6.2&&++tries<40);
    const h=0.16+rnd()*0.2,w=0.2+rnd()*0.18;
    dummy.position.set(x,h/2,z);dummy.scale.set(0.12,h,0.12);dummy.rotation.set(0,rnd()*6.28,0);dummy.updateMatrix();
    stalks.setMatrixAt(m,dummy.matrix);
    dummy.position.set(x,h+w*0.75,z);dummy.scale.set(w,w*0.6,w);dummy.rotation.set(0,rnd()*6.28,0);dummy.updateMatrix();
    caps.setMatrixAt(m,dummy.matrix);
    dummy.position.set(x+w*0.4,h+w*0.62,z);dummy.scale.setScalar(w*0.16);dummy.rotation.set(0,0,0);dummy.updateMatrix();
    dots.setMatrixAt(m*2,dummy.matrix);
    dummy.position.set(x-w*0.12,h+w*0.8,z+w*0.38);dummy.scale.setScalar(w*0.13);dummy.updateMatrix();
    dots.setMatrixAt(m*2+1,dummy.matrix);
  }
  // Butterflies wobble around the meadow; wings are pre-tilted so each frame
  // only needs a position plus a yaw.
  const wingMaterial=new THREE.MeshStandardMaterial({color:0xd96ff0,roughness:0.6,side:THREE.DoubleSide});
  const wing=new THREE.PlaneGeometry(0.7,0.55);
  const tilt=new THREE.Object3D();
  tilt.rotation.set(-Math.PI/2+0.42,0,0);tilt.updateMatrix();
  const wingsL=carpet(scene,wing.clone().applyMatrix4(tilt.matrix),wingMaterial,14);
  tilt.rotation.set(-Math.PI/2-0.42,0,0);tilt.updateMatrix();
  const wingsR=carpet(scene,wing.clone().applyMatrix4(tilt.matrix),wingMaterial,14);
  const bodyTilt=new THREE.Object3D();
  bodyTilt.rotation.set(Math.PI/2,0,0);bodyTilt.updateMatrix();
  const capsules=carpet(scene,new THREE.CapsuleGeometry(0.06,0.26,3,4).applyMatrix4(bodyTilt.matrix),new THREE.MeshStandardMaterial({color:0x3a3a44,roughness:0.7}),14);
  for(const mesh of [wingsL,wingsR,capsules]) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const butterflies=[];
  for(let i=0;i<14;i++)butterflies.push({x:(rnd()-0.5)*260,z:(rnd()-0.5)*260,y:1.7+rnd()*1.5,phase:rnd()*6.28,drift:3+rnd()*6});
  function animate(t) {
    for(let i=0;i<butterflies.length;i++) {
      const b=butterflies[i],t0=t*0.28+b.phase;
      const yaw=Math.sin(t0)*1.4;
      const bx=b.x+Math.cos(t0*0.9)*b.drift,bz=b.z+Math.sin(t0*0.9)*b.drift,by=b.y+Math.sin(t*1.4+b.phase)*0.3;
      const cx=Math.cos(yaw),sx=Math.sin(yaw);
      dummy.position.set(bx,by,bz);dummy.rotation.set(0,yaw,0);dummy.scale.setScalar(1);dummy.updateMatrix();
      capsules.setMatrixAt(i,dummy.matrix);
      dummy.position.set(bx-cx*0.13,by,bz+sx*0.13);dummy.rotation.set(0,yaw,0);dummy.scale.setScalar(1);dummy.updateMatrix();
      wingsL.setMatrixAt(i,dummy.matrix);
      dummy.position.set(bx+cx*0.13,by,bz-sx*0.13);dummy.rotation.set(0,yaw,0);dummy.scale.setScalar(1);dummy.updateMatrix();
      wingsR.setMatrixAt(i,dummy.matrix);
    }
    wingsL.instanceMatrix.needsUpdate=wingsR.instanceMatrix.needsUpdate=capsules.instanceMatrix.needsUpdate=true;
  }
  return {animate};
}

export function decorateCity(scene) {
  let seed=4242;
  const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const dummy=new THREE.Object3D();
  // Balloon bunches bobbing from every lamp post.
  const balloonColors=[0xff5f7a,0xffc94d,0x3db9f2,0xe56ff0];
  const balloons=balloonColors.map(c=>carpet(scene,new THREE.SphereGeometry(1,8,7),new THREE.MeshStandardMaterial({color:c,roughness:0.5}),6));
  const strings=carpet(scene,new THREE.CylinderGeometry(0.5,0.5,1,5),new THREE.MeshStandardMaterial({color:0xd9d2c6,roughness:0.8}),24);
  let bi=0;
  for(let x=-150;x<=150;x+=50)
    for(let z=-125;z<=125;z+=50) {
      dummy.position.set(x+8,6.4,z);dummy.scale.setScalar(0.75+rnd()*0.3);dummy.rotation.set(0,rnd()*6.28,0);dummy.updateMatrix();
      balloons[bi%4].setMatrixAt(Math.floor(bi/4),dummy.matrix);
      dummy.position.set(x+8,3.2,z);dummy.scale.set(0.02,3.4,0.02);dummy.rotation.set(0,0,0);dummy.updateMatrix();
      strings.setMatrixAt(bi,dummy.matrix);
      bi++;
    }
  // Leafy street trees line the sidewalks between the lamps.
  const foliage=carpet(scene,new THREE.SphereGeometry(1,9,7),new THREE.MeshStandardMaterial({color:0x5a9e4b,roughness:0.9}),16);
  const trunks=carpet(scene,new THREE.CylinderGeometry(0.5,0.5,1,5),new THREE.MeshStandardMaterial({color:0x6b4a34,roughness:0.9}),16);
  let ti=0;
  for(let gx=-150;gx<=150&&ti<16;gx+=100)
    for(let gz=-100;gz<=100&&ti<16;gz+=50) {
      const x=gx+8,z=gz+25;
      const h=2+rnd()*1.2,w=0.9+rnd()*0.5;
      dummy.position.set(x,h/2,z);dummy.scale.set(0.13,h,0.13);dummy.rotation.set(0,0,0);dummy.updateMatrix();
      trunks.setMatrixAt(ti,dummy.matrix);
      dummy.position.set(x,h+w*0.9,z);dummy.scale.set(w,w*0.85,w);dummy.rotation.set(0,rnd()*6.28,0);dummy.updateMatrix();
      foliage.setMatrixAt(ti,dummy.matrix);
      ti++;
    }
}

export function decorateStuntPark(scene) {
  let seed=777;
  const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const dummy=new THREE.Object3D();
  // Colorful pennant flags ring the whole park.
  const colors=[0xff5f7a,0xffc94d,0x3db9f2,0x79e07b];
  const poles=carpet(scene,new THREE.CylinderGeometry(0.06,0.06,2.6,6),new THREE.MeshStandardMaterial({color:0x39424b,roughness:0.7}),28);
  const flags=colors.map(c=>carpet(scene,new THREE.PlaneGeometry(0.55,0.85),new THREE.MeshStandardMaterial({color:c,roughness:0.6,side:THREE.DoubleSide}),7));
  for(let i=0;i<28;i++) {
    const a=i/28*Math.PI*2+0.2,x=Math.sin(a)*232,z=Math.cos(a)*232;
    dummy.position.set(x,1.3,z);dummy.rotation.set(0,0,0);dummy.updateMatrix();
    poles.setMatrixAt(i,dummy.matrix);
    dummy.position.set(x,2.7,z);dummy.rotation.set(0,-a-0.2,0);dummy.updateMatrix();
    flags[i%4].setMatrixAt(Math.floor(i/4),dummy.matrix);
  }
  // Painted hopscotch rings behind the home straight.
  const ringColors=[0xffe082,0x7ec8f2,0xf28b7e,0x9be07e,0xffc64d];
  for(let i=0;i<5;i++) {
    const ring=new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,0.03,20),new THREE.MeshStandardMaterial({color:ringColors[i],side:THREE.DoubleSide}));
    ring.position.set(-42+i*3.4,0.08,138);
    scene.add(ring);
  }
}
