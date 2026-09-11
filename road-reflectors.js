const reflectiveMaterials = new WeakSet();

// Three r170 WebGL materials only. Apply to each clone; meshes must receive shadows.
export function retroreflectiveMaterial(material) {
  if (!material.isMeshStandardMaterial) throw new TypeError("Retroreflection requires MeshStandardMaterial");
  if (reflectiveMaterials.has(material)) return material;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    const include = "#include <lights_physical_pars_fragment>";
    if (!shader.fragmentShader.includes(include)) throw new Error("Retroreflection requires lights_physical_pars_fragment");
    shader.fragmentShader = shader.fragmentShader.replace(include, `${include}
void RE_Direct_Retroreflective(const in IncidentLight incidentLight,
  const in vec3 geometryPosition, const in vec3 geometryNormal,
  const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  // Expand the existing RE_Direct before redefining it, preserving physical lighting.
  RE_Direct(incidentLight, geometryPosition, geometryNormal, geometryViewDir,
    geometryClearcoatNormal, material, reflectedLight);
  float luminance = dot(material.diffuseColor, vec3(0.2126, 0.7152, 0.0722));
  float markings = smoothstep(0.18, 0.65, luminance);
  // Full return within 11 degrees, fading to zero at 41 degrees for chase views.
  float alignment = smoothstep(0.75, 0.98, dot(incidentLight.direction, geometryViewDir));
  float facing = saturate(dot(geometryNormal, incidentLight.direction));
  vec3 tint = mix(clamp(material.diffuseColor, 0.0, 1.0), vec3(1.0), 0.75);
  // incidentLight.color already includes distance, spotlight cone/maps and shadows.
  vec3 returnLight = clamp(incidentLight.color * (6.0 * facing), vec3(0.0), vec3(4.0));
  reflectedLight.directSpecular += returnLight * tint * markings * alignment;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Retroreflective
`);
  };
  // Three's default cache key reads this hook's source; retain the previous identity.
  material.onBeforeCompile.toString = () => compile.toString();
  material.customProgramCacheKey = function () {
    return `${cacheKey.call(this)}/retroreflective-v1`;
  };
  material.needsUpdate = true;
  reflectiveMaterials.add(material);
  return material;
}
