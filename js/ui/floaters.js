// DOM 飘字：伤害数字 / 金币 / 提示，投影世界坐标到屏幕后 CSS 动画上浮消散
import * as THREE from 'three';

export class Floaters {
  constructor(camera) {
    this.camera = camera;
    this.root = document.createElement('div');
    this.root.id = 'floaters';
    document.body.appendChild(this.root);
    this._v = new THREE.Vector3();
  }

  _spawn(text, cls) {
    if (this.root.children.length > 60) this.root.firstChild?.remove();
    const el = document.createElement('span');
    el.className = 'floater ' + cls;
    el.textContent = text;
    el.style.left = this._x + 'px';
    el.style.top = this._y + 'px';
    el.style.setProperty('--dx', ((Math.random() - 0.5) * 26).toFixed(0) + 'px');
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  at(worldPos, text, cls = '') {
    this._v.copy(worldPos).project(this.camera);
    if (this._v.z > 1) return;
    this._x = (this._v.x * 0.5 + 0.5) * innerWidth;
    this._y = (-this._v.y * 0.5 + 0.5) * innerHeight;
    this._spawn(text, cls);
  }

  damage(pos, n, crit = false, colorCls = '') { this.at(pos, crit ? `${n}!` : `${n}`, (crit ? 'crit ' : 'dmg ') + colorCls); }
  gold(pos, n) { this.at(pos, `+${n} ⛁`, 'goldf'); }
  text(pos, str, cls = '') { this.at(pos, str, 'info ' + cls); }
}
