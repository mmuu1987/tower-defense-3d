// 自研轻量后处理：场景RT(HDR) → 亮度提取 → 可分离高斯模糊(半分辨率) → 合成(ACES+gamma)
// 不依赖 three/addons，离线可用；bloom 关闭时仍走合成通道保证色调一致。
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tScene; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float w = smoothstep(uThreshold, uThreshold + uKnee, l);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tIn; uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 sum = texture2D(tIn, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += (texture2D(tIn, vUv + o1).rgb + texture2D(tIn, vUv - o1).rgb) * 0.3162162162;
  sum += (texture2D(tIn, vUv + o2).rgb + texture2D(tIn, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float uBloomStrength; uniform float uSaturation;
varying vec2 vUv;
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb;
  c += b * uBloomStrength;
  c = aces(c * 0.85);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = pow(c, vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}`;

function makePass(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export class PostFX {
  constructor(renderer, preset) {
    this.renderer = renderer;
    this.enabledBloom = !!preset.bloom;
    this.strength = 0.55;
    this.iterations = preset.bloomIter || 2;

    const w = () => Math.max(8, Math.floor(window.innerWidth * renderer.getPixelRatio()));
    const h = () => Math.max(8, Math.floor(window.innerHeight * renderer.getPixelRatio()));

    this.rtScene = new THREE.WebGLRenderTarget(w(), h(), {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const bw = () => Math.max(8, Math.floor(w() * preset.bloomRes));
    const bh = () => Math.max(8, Math.floor(h() * preset.bloomRes));
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(bw(), bh(), rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(bw(), bh(), rtOpts);

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.Camera();
    this.matBright = makePass(BRIGHT_FRAG, {
      tScene: { value: null }, uThreshold: { value: 0.82 }, uKnee: { value: 0.42 },
    });
    this.matBlur = makePass(BLUR_FRAG, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.matComposite = makePass(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null },
      uBloomStrength: { value: this.enabledBloom ? this.strength : 0 },
      uSaturation: { value: 1.06 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.matComposite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(8, Math.floor(window.innerWidth * pr));
    const h = Math.max(8, Math.floor(window.innerHeight * pr));
    this.rtScene.setSize(w, h);
    const bw = Math.max(8, Math.floor(w * 0.5));
    const bh = Math.max(8, Math.floor(h * 0.5));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
  }

  setBloom(on) { this.enabledBloom = on; this.matComposite.uniforms.uBloomStrength.value = on ? this.strength : 0; }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, camera) {
    // 1) 场景 -> HDR RT（线性空间）
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    if (this.enabledBloom) {
      // 2) 亮度提取
      this.matBright.uniforms.tScene.value = this.rtScene.texture;
      this._blit(this.matBright, this.rtA);
      // 3) H/V 模糊迭代
      for (let i = 0; i < this.iterations; i++) {
        this.matBlur.uniforms.tIn.value = this.rtA.texture;
        this.matBlur.uniforms.uDir.value.set(1 / this.rtA.width, 0);
        this._blit(this.matBlur, this.rtB);
        this.matBlur.uniforms.tIn.value = this.rtB.texture;
        this.matBlur.uniforms.uDir.value.set(0, 1 / this.rtB.height);
        this._blit(this.matBlur, this.rtA);
      }
      this.matComposite.uniforms.tBloom.value = this.rtA.texture;
    }

    // 4) 合成到屏幕：加法泛光 + ACES + gamma
    this.matComposite.uniforms.tScene.value = this.rtScene.texture;
    this._blit(this.matComposite, null);
  }
}
