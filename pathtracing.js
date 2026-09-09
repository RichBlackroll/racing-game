import { WebGLPathTracer, DenoiseMaterial } from 'three-gpu-pathtracer';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
export function createPathTracing(renderer,scene,camera){
 const pt=new WebGLPathTracer(renderer);
 Object.assign(pt,{bounces:4,transmissiveBounces:3,filterGlossyFactor:.5,renderDelay:0,minSamples:1,fadeDuration:0,renderScale:.6,rasterizeScene:false,renderToCanvas:false});
 pt.tiles.set(1,1);pt.textureSize.set(512,512);pt.setScene(scene,camera);
 const denoise=new FullScreenQuad(new DenoiseMaterial({sigma:2,kSigma:1,threshold:.08}));
 return {pt,denoise};
}
