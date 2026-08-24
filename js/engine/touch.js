// 触摸手势层：把 canvas 上的触摸指针转译为相机操作与"轻点"事件
//   单指轻点（位移<12px 且 <450ms）→ onTap(x,y)（建造/选塔，与鼠标点击同逻辑）
//   单指拖动 → 相机平移；双指捏合 → 缩放；双指旋转 → 视角旋转；双指中心移动 → 平移
// 鼠标指针（pointerType==='mouse'）完全不经过这里，桌面行为零改动
export class TouchGestures {
  constructor(dom, rig, { onTap } = {}) {
    this.dom = dom;
    this.rig = rig;
    this.onTap = onTap;
    this.pointers = new Map();   // pointerId -> {x,y}
    this.start = null;           // 单指起点 {x,y,moved}
    this.pinch = null;           // 双指基准 {dist,midX,midY,ang}
    this.TAP_PX = 12;
    // 轻点判定只用位移阈值，不设时长上限：没有长按语义，且低端机卡顿会把
    // down→up 拉到数百毫秒（实测软渲染 649~934ms），时长判定只会误杀

    dom.style.touchAction = 'none'; // 浏览器手势（滚动/双击缩放/下拉刷新）全交给游戏

    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.start = { x: e.clientX, y: e.clientY, moved: false };
      } else {
        this.start = null;               // 进入双指，取消待定轻点
        if (this.pointers.size === 2) this._initPinch();
      }
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;                    // 非触摸或未按下的指针
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;

      if (this.pointers.size === 1 && this.start) {
        const sx = e.clientX - this.start.x, sy = e.clientY - this.start.y;
        if (!this.start.moved && sx * sx + sy * sy > this.TAP_PX * this.TAP_PX) {
          this.start.moved = true;       // 超过阈值判定为拖动，轻点作废
        }
        if (this.start.moved) this.rig.panByPixels(dx, dy);
      } else if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.rig.zoomBy(this.pinch.dist / dist);            // 张开=放大
        this.rig.panByPixels(midX - this.pinch.midX, midY - this.pinch.midY);
        this.rig.rotateBy(-(ang - this.pinch.ang));         // 捻转=旋转视角
        this.pinch = { dist, midX, midY, ang };
      }
    });

    const release = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.lastTap = { x: e.clientX, y: e.clientY, moved: this.start?.moved };
        if (this.start && !this.start.moved && this.onTap) this.onTap(e.clientX, e.clientY);
        this.start = null;
        this.pinch = null;
      } else if (this.pointers.size === 1) {
        this.pinch = null;               // 抬起一指：回到单指，重设拖动基准
        const [only] = this.pointers.values();
        this.start = { x: only.x, y: only.y, t: 0, moved: true }; // 不再触发轻点
      }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  _initPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2,
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
}
