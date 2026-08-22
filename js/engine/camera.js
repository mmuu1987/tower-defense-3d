// RTS 相机：焦点平移（WASD/中键拖拽）、滚轮缩放、Q/E 旋转，全部带指数平滑
import * as THREE from 'three';

export class CameraRig {
  constructor(camera, dom, bounds) {
    this.cam = camera;
    this.dom = dom;
    this.bounds = bounds; // {minX,maxX,minZ,maxZ}
    this.pitch = 0.94;    // 约54°
    this.yaw = 0;
    this.dist = 20;

    this.cur = { focus: new THREE.Vector3(0, 0, 1), yaw: this.yaw, dist: this.dist };
    this.keys = new Set();
    this.dragging = false;
    this.lastX = 0; this.lastY = 0;
    this.shakeAmp = 0;
    this._shakeOff = new THREE.Vector3();

    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; e.preventDefault(); }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const k = 0.0042 * this.cur.dist;
      const f = this._horizForward(), r = this._right();
      this._moveFocus(r * -(e.clientX - this.lastX) * k + f * (e.clientY - this.lastY) * k);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.0012), 9, 38);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _horizForward() {
    return new THREE.Vector3(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw));
  }
  _right() {
    return new THREE.Vector3(Math.cos(this.cur.yaw), 0, -Math.sin(this.cur.yaw));
  }
  _moveFocus(delta) {
    this.cur.focus.add(delta);
    const b = this.bounds;
    this.cur.focus.x = THREE.MathUtils.clamp(this.cur.focus.x, b.minX, b.maxX);
    this.cur.focus.z = THREE.MathUtils.clamp(this.cur.focus.z, b.minZ, b.maxZ);
  }

  update(dt) {
    // 键盘：平移 + Q/E 旋转
    let panF = 0, panR = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) panF += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) panF -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) panR += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) panR -= 1;
    if (panF || panR) {
      const speed = 9 * this.cur.dist * 0.12 * dt;
      this._moveFocus(this._horizForward().multiplyScalar(panF * speed)
        .add(this._right().multiplyScalar(panR * speed)));
    }
    if (this.keys.has('KeyQ')) this.cur.yaw += 1.6 * dt;
    if (this.keys.has('KeyE')) this.cur.yaw -= 1.6 * dt;

    // 平滑距离
    this.cur.dist += (this.dist - this.cur.dist) * (1 - Math.exp(-dt * 8));

    // 由焦点/yaw/pitch/dist 推出相机位置
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const pos = new THREE.Vector3(
      this.cur.focus.x + Math.sin(this.cur.yaw) * cp * this.cur.dist,
      sp * this.cur.dist,
      this.cur.focus.z + Math.cos(this.cur.yaw) * cp * this.cur.dist,
    );
    this.cam.position.copy(pos);
    this.cam.lookAt(this.cur.focus.x, this.cur.focus.y + 0.4, this.cur.focus.z);

    // 屏幕震动（衰减 + 随机偏移）
    if (this.shakeAmp > 0.001) {
      this._shakeOff.set(
        (Math.random() - 0.5), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5),
      ).multiplyScalar(this.shakeAmp);
      this.cam.position.add(this._shakeOff);
      this.shakeAmp *= Math.exp(-dt * 7);
    } else this.shakeAmp = 0;
  }

  shake(amp) { this.shakeAmp = Math.min(0.5, Math.max(this.shakeAmp, amp)); }

  screenRay(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cam);
    return ray;
  }
}
