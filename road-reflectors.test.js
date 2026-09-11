import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { retroreflectiveMaterial } from "./road-reflectors.js";

function shaderFor(material) {
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
  material.onBeforeCompile(shader, null);
  return shader;
}

test("composes hooks with their receiver, arguments, edits and live cache key", () => {
  const material = new THREE.MeshStandardMaterial(), renderer = {};
  let calls = 0, keyCalls = 0;
  material.userData.variant = "a";
  material.onBeforeCompile = function (shader, receivedRenderer) {
    assert.equal(this, material);
    assert.equal(receivedRenderer, renderer);
    calls++;
    shader.uniforms.previous = { value: 2 };
    shader.vertexShader += "\n// previous vertex hook";
    shader.fragmentShader += "\n// previous fragment hook";
  };
  material.customProgramCacheKey = function () {
    assert.equal(this, material);
    keyCalls++;
    return `previous-${this.userData.variant}`;
  };
  const version = material.version;
  assert.equal(retroreflectiveMaterial(material), material);
  assert.equal(material.version, version + 1);
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
  material.onBeforeCompile(shader, renderer);
  assert.equal(calls, 1);
  assert.deepEqual(shader.uniforms, { previous: { value: 2 } });
  assert.match(shader.vertexShader, /previous vertex hook/);
  assert.match(shader.fragmentShader, /previous fragment hook/);
  assert.match(shader.fragmentShader, /void RE_Direct_Retroreflective/);
  assert.equal(material.customProgramCacheKey(), "previous-a/retroreflective-v1");
  material.userData.variant = "b";
  assert.equal(material.customProgramCacheKey(), "previous-b/retroreflective-v1");
  assert.equal(keyCalls, 2);
});

test("default cache keys retain earlier shader identities and shared materials wrap only once", () => {
  const a = new THREE.MeshStandardMaterial(), b = a.clone(), c = a.clone();
  a.onBeforeCompile = shader => { shader.uniforms.a = { value: 1 }; };
  b.onBeforeCompile = shader => { shader.uniforms.b = { value: 1 }; };
  for (const material of [a, b, c]) {
    const key = material.customProgramCacheKey();
    retroreflectiveMaterial(material);
    assert.equal(material.customProgramCacheKey(), `${key}/retroreflective-v1`);
    const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey, version = material.version;
    assert.equal(retroreflectiveMaterial(material), material);
    assert.equal(material.onBeforeCompile, compile);
    assert.equal(material.customProgramCacheKey, cacheKey);
    assert.equal(material.version, version);
    assert.equal(shaderFor(material).fragmentShader.match(/void RE_Direct_Retroreflective/g).length, 1);
  }
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
  assert.notEqual(b.customProgramCacheKey(), c.customProgramCacheKey());
  const clone = retroreflectiveMaterial(c.clone());
  assert.equal(clone.customProgramCacheKey(), c.customProgramCacheKey());
});

test("preserves authored PBR, emission, metadata, vertex shader and uniforms", () => {
  const material = new THREE.MeshStandardMaterial({
    color: 0xded7b2, roughness: 0.83, metalness: 0.12,
    map: new THREE.Texture(), emissive: 0x123456, emissiveIntensity: 0.37,
    emissiveMap: new THREE.Texture(), side: THREE.DoubleSide,
  });
  material.userData.authored = { keep: true };
  const before = material.toJSON(), metadata = material.userData;
  const emissive = material.emissive, onBeforeRender = material.onBeforeRender;
  retroreflectiveMaterial(material);
  const shader = shaderFor(material);
  assert.deepEqual(material.toJSON(), before);
  assert.equal(material.userData, metadata);
  assert.equal(material.emissive, emissive);
  assert.equal(material.onBeforeRender, onBeforeRender);
  assert.equal(shader.vertexShader, THREE.ShaderLib.standard.vertexShader);
  assert.deepEqual(shader.uniforms, {});
});

test("r170 wrapper preserves includes and receives evaluated, shadowed direct light", () => {
  assert.equal(THREE.REVISION, "170", "review shader integration when upgrading Three");
  const source = shaderFor(retroreflectiveMaterial(new THREE.MeshStandardMaterial())).fragmentShader;
  const include = "#include <lights_physical_pars_fragment>";
  const start = source.indexOf("void RE_Direct_Retroreflective");
  const end = source.indexOf("#define RE_Direct RE_Direct_Retroreflective") + "#define RE_Direct RE_Direct_Retroreflective".length;
  const wrapper = source.slice(start, end);
  assert.ok(source.indexOf(include) < start && end < source.indexOf("void main()"));
  assert.equal(source.slice(0, start).trimEnd() + source.slice(end).replace(/^\s*/, "\n"), THREE.ShaderLib.standard.fragmentShader);
  assert.match(THREE.ShaderChunk.lights_physical_pars_fragment, /#define RE_Direct\s+RE_Direct_Physical/);
  assert.match(wrapper, /RE_Direct\(incidentLight,[\s\S]*?#undef RE_Direct\n#define RE_Direct RE_Direct_Retroreflective/);
  assert.match(wrapper, /clamp\(incidentLight\.color \* \(6\.0 \* facing\), vec3\(0\.0\), vec3\(4\.0\)\)/);
  assert.doesNotMatch(wrapper, /uniform|emissive|ambient|night|pointLights\[|spotLights\[|directionalLights\[/);
  const lighting = THREE.ShaderChunk.lights_fragment_begin;
  for (const [getInfo, shadow] of [["getPointLightInfo", "getPointShadow"], ["getSpotLightInfo", "getShadow"], ["getDirectionalLightInfo", "getShadow"]]) {
    const light = lighting.slice(lighting.indexOf(`${getInfo}(`));
    assert.match(light.slice(0, light.indexOf("RE_Direct(")), new RegExp(`directLight\\.color \\*= [^;]*${shadow}\\(`));
  }
  assert.match(THREE.ShaderChunk.lights_pars_begin, /light\.color = spotLight\.color \* spotAttenuation;\s*light\.color \*= getDistanceAttenuation/);
  assert.match(THREE.ShaderChunk.lights_physical_fragment, /material\.diffuseColor = diffuseColor\.rgb \* \( 1\.0 - metalnessFactor \)/);
});

test("markings use shaded diffuse luminance with a broad but finite source/view lobe", () => {
  const source = shaderFor(retroreflectiveMaterial(new THREE.MeshStandardMaterial())).fragmentShader;
  assert.match(source, /dot\(material\.diffuseColor, vec3\(0\.2126, 0\.7152, 0\.0722\)\)/);
  assert.match(source, /float markings = smoothstep\(0\.18, 0\.65, luminance\)/);
  assert.match(source, /float alignment = smoothstep\(0\.75, 0\.98, dot\(incidentLight\.direction, geometryViewDir\)\)/);
  assert.match(source, /float facing = saturate\(dot\(geometryNormal, incidentLight\.direction\)\)/);
  assert.match(source, /mix\(clamp\(material\.diffuseColor, 0\.0, 1\.0\), vec3\(1\.0\), 0\.75\)/);
  assert.match(source, /reflectedLight\.directSpecular \+= returnLight \* tint \* markings \* alignment/);
  const lobe = degrees => THREE.MathUtils.smoothstep(Math.cos(THREE.MathUtils.degToRad(degrees)), 0.75, 0.98);
  assert.equal(lobe(0), 1);
  assert.ok(lobe(20) > 0.9 && lobe(30) > 0.5);
  assert.equal(lobe(45), 0);
  assert.equal(lobe(90), 0);
  assert.equal(lobe(180), 0);
});

test("incompatible materials and missing shader anchors fail explicitly", () => {
  assert.throws(() => retroreflectiveMaterial(new THREE.MeshBasicMaterial()), /requires MeshStandardMaterial/);
  const material = retroreflectiveMaterial(new THREE.MeshStandardMaterial());
  assert.throws(() => material.onBeforeCompile({ fragmentShader: "void main() {}" }), /requires lights_physical_pars_fragment/);
});

// Opt in with an existing Playwright module path; no project dependency is needed.
test("WebGL compiles instanced signs and retains occlusion, attenuation and angular masking", {
  skip: !process.env.ROAD_REFLECTORS_PLAYWRIGHT,
  timeout: 60000,
}, async t => {
  const { chromium } = await import(process.env.ROAD_REFLECTORS_PLAYWRIGHT);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ROAD_REFLECTORS_CHROME || undefined,
    args: ["--enable-unsafe-swiftshader"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const files = new Map([
    ["/three.js", await readFile(new URL("./node_modules/three/build/three.module.js", import.meta.url), "utf8")],
    ["/road-reflectors.js", await readFile(new URL("./road-reflectors.js", import.meta.url), "utf8")],
  ]);
  await page.route("http://reflectors.test/**", route => {
    const source = files.get(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: source ? "text/javascript" : "text/html", body: source || "<!doctype html><title>Reflectors</title>" });
  });
  await page.goto("http://reflectors.test/");
  const result = await page.evaluate(async () => {
    const THREE = await import("/three.js");
    const { retroreflectiveMaterial } = await import("/road-reflectors.js");
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(64, 64);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.FloatType });
    const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    map.needsUpdate = true;
    const plain = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, map });
    const retro = retroreflectiveMaterial(plain.clone());
    const sign = new THREE.InstancedMesh(new THREE.PlaneGeometry(8, 8), retro, 1);
    sign.setMatrixAt(0, new THREE.Matrix4());
    sign.setColorAt(0, new THREE.Color(0xffffff));
    sign.receiveShadow = true;
    scene.add(sign);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const spot = new THREE.SpotLight(0xffffff, 20, 30, Math.PI / 5, 0.3, 2);
    spot.position.set(1, 0, 5);
    spot.castShadow = true;
    spot.shadow.mapSize.set(512, 512);
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1, 0.4), plain);
    blocker.position.set(0.5, 0, 2.5);
    blocker.castShadow = true;
    blocker.visible = false;
    scene.add(spot, spot.target, blocker);
    const pixel = new Float32Array(4);
    function sample() {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
      return pixel[0];
    }
    function gain() {
      sign.material = plain;
      const base = sample();
      sign.material = retro;
      return sample() - base;
    }
    const lit = gain(), calls = renderer.info.render.calls;
    camera.position.set(0, 3.6, 10); camera.lookAt(0, 0, 0);
    const chase = gain();
    camera.position.set(20, 0, 10); camera.lookAt(0, 0, 0);
    const offAxis = gain();
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
    sign.setColorAt(0, new THREE.Color(0x111111)); sign.instanceColor.needsUpdate = true;
    const dark = gain();
    sign.setColorAt(0, new THREE.Color(0xffffff)); sign.instanceColor.needsUpdate = true;
    map.image.data.set([8, 8, 8, 255]); map.needsUpdate = true;
    const darkMap = gain();
    map.image.data.set([255, 255, 255, 255]); map.needsUpdate = true;
    blocker.visible = true;
    const shadow = gain();
    blocker.visible = false;
    spot.target.position.set(20, 0, 0);
    const outsideCone = gain();
    spot.target.position.set(0, 0, 0);
    spot.position.set(2, 0, 10);
    const distant = gain();
    spot.distance = 5;
    const beyondRange = gain();
    spot.intensity = 0;
    const unlit = sample();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const ambient = gain();
    const programs = renderer.info.programs.map(program => program.diagnostics?.runnable !== false);
    renderer.dispose(); target.dispose(); map.dispose(); spot.dispose();
    sign.geometry.dispose(); blocker.geometry.dispose(); plain.dispose(); retro.dispose();
    return { lit, chase, offAxis, dark, darkMap, shadow, outsideCone, distant, beyondRange, unlit, ambient, calls, programs };
  });
  assert.deepEqual(errors, []);
  assert.ok(result.programs.length > 0 && result.programs.every(Boolean));
  assert.ok(result.lit > 1 && result.lit <= 4.0001, JSON.stringify(result));
  assert.ok(result.chase > result.lit * 0.7, JSON.stringify(result));
  assert.ok(result.distant > 0 && result.distant < result.lit * 0.4, JSON.stringify(result));
  for (const key of ["offAxis", "dark", "darkMap", "shadow", "outsideCone", "beyondRange", "unlit", "ambient"]) {
    assert.ok(Math.abs(result[key]) < 0.0001, `${key}: ${result[key]}`);
  }
  assert.equal(result.calls, 1, "one existing instanced sign draw");
  t.diagnostic(JSON.stringify(result));
});
