import * as THREE from "three";
import { retroreflectiveMaterial } from "./road-reflectors.js";

export function createCourseDetails({ scene, course, obstacles }) {
  const group = new THREE.Group();
  group.name = "course/wayfinding";
  scene.add(group);
  const signs = [];
  const { route, heightAt } = course;
  const step = Math.max(1, Math.round(35 / (course.length / route.length)));
  for (let i = step; i < route.length - step; i += step) {
    const a = route[i - step], p = route[i], b = route[i + step];
    const incoming = new THREE.Vector2(p.x - a.x, p.z - a.z).normalize();
    const outgoing = new THREE.Vector2(b.x - p.x, b.z - p.z).normalize();
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    if (Math.abs(cross) < .38) continue;
    const side = -Math.sign(cross);
    const x = p.x - incoming.y * 8.7 * side, z = p.z + incoming.x * 8.7 * side;
    // Streets remain fully explorable; signs cannot occupy a crossing or another road.
    if (course.roadDistance(x, z) < 7) continue;
    if (course.isSafePosition && !course.isSafePosition(x, z, .3)) continue;
    const y = heightAt(x, z);
    signs.push({ x, y, z, heading: Math.atan2(-incoming.x, -incoming.y), left: cross < 0 });
    obstacles.push({ x, y, z, r: .12, height: 2.4 });
  }
  if (!signs.length) return group;
  const dummy = new THREE.Object3D();
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.055, .07, 2.25, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b6d62, metalness: .65, roughness: .45 }), signs.length);
  signs.forEach((sign, i) => {
    dummy.position.set(sign.x, sign.y + 1.125, sign.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  });
  group.add(posts);
  for (const left of [false, true]) {
    const selected = signs.filter(sign => sign.left === left);
    if (!selected.length) continue;
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128;
    const c = canvas.getContext("2d");
    c.fillStyle = "#dcd5b4"; c.fillRect(0, 0, 256, 128);
    c.fillStyle = "#263b36"; c.fillRect(5, 5, 246, 118);
    c.strokeStyle = "#ece0b2"; c.lineWidth = 14; c.lineJoin = "round";
    for (const x of [70, 155]) {
      c.beginPath(); c.moveTo(x + (left ? 35 : 0), 29); c.lineTo(x + (left ? 0 : 35), 64);
      c.lineTo(x + (left ? 35 : 0), 99); c.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const boards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, .7),
      retroreflectiveMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: .6, side: THREE.DoubleSide })), selected.length);
    boards.receiveShadow = true;
    selected.forEach((sign, i) => {
      dummy.position.set(sign.x, sign.y + 2.05, sign.z); dummy.rotation.set(0, sign.heading, 0); dummy.updateMatrix();
      boards.setMatrixAt(i, dummy.matrix);
    });
    group.add(boards);
  }
  return group;
}

export function createCourseHUD(course) {
  const card = document.querySelector(".map-card");
  const caption = card.querySelector(".map-caption");
  const profile = document.createElement("canvas");
  profile.width = 276; profile.height = 62;
  profile.style.cssText = "width:100%;height:31px;display:block;margin:0 0 6px";
  profile.setAttribute("role", "img");
  profile.setAttribute("aria-label", `Elevation profile: ${(course.length / 1000).toFixed(2)} kilometres, ${Math.round(course.elevation.gain)} metres of climbing`);
  card.insertBefore(profile, caption);
  const label = document.createElement("span");
  label.style.cssText = "font-size:9px;letter-spacing:.04em;line-height:1.5;white-space:pre-line";
  caption.replaceChildren(label);
  const c = profile.getContext("2d"), { min, max } = course.elevation;
  const y = altitude => 53 - (altitude - min) / Math.max(4, max - min) * 45;
  return function update(position, grade, lapSeconds, bestLap) {
    c.clearRect(0, 0, 276, 62);
    c.beginPath(); c.moveTo(3, 57);
    course.route.forEach((p, i) => c.lineTo(3 + i / (course.route.length - 1) * 270, y(p.y)));
    c.lineTo(273, 57); c.closePath();
    c.fillStyle = "#bacdb328"; c.fill();
    c.beginPath(); course.route.forEach((p, i) => i ? c.lineTo(3 + i / (course.route.length - 1) * 270, y(p.y)) : c.moveTo(3, y(p.y)));
    c.strokeStyle = "#a9c4ad"; c.lineWidth = 1.7; c.stroke();
    const hit = course.nearest(position.x, position.z), progress = hit.along / course.length;
    const x = 3 + progress * 270;
    c.strokeStyle = "#e9d6ad"; c.beginPath(); c.moveTo(x, 4); c.lineTo(x, 57); c.stroke();
    c.fillStyle = "#fff1cf"; c.beginPath(); c.arc(x, y(hit.height), 3, 0, Math.PI * 2); c.fill();
    const slope = Math.round(grade * 100);
    label.textContent = `${(course.length / 1000).toFixed(2)} km / +${Math.round(course.elevation.gain)} m\n${Math.round(position.y)} m ALT / ${slope > 1 ? "CLIMB" : slope < -1 ? "DESCENT" : "LEVEL"} ${Math.abs(slope)}%`;
    label.title = `${Math.round(position.y)} m altitude. ${slope}% grade. Lap ${lapSeconds.toFixed(1)} s${bestLap ? `. Best ${bestLap.toFixed(1)} s` : ""}`;
  };
}
