// 存档：进度星级 + 设置（localStorage，键 td_save_v1）
const KEY = 'td_save_v1';

const DEFAULTS = {
  v: 1,
  levels: {},        // "w,l": stars(1..3)
  settings: { volume: 0.55, muted: false, quality: 'high' },
  tutorialDone: false,
};

export const save = {
  data: null,

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw ? { ...structuredClone(DEFAULTS), ...JSON.parse(raw) } : structuredClone(DEFAULTS);
      this.data.settings = { ...DEFAULTS.settings, ...(this.data.settings || {}) };
    } catch {
      this.data = structuredClone(DEFAULTS);
    }
    return this.data;
  },

  persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {}
  },

  getStars(w, l) { return this.data.levels[`${w},${l}`] || 0; },

  isUnlocked(w, l) {
    if (w === 0 && l === 0) return true;
    if (l === 0) return this.getStars(w - 1, 9) > 0; // 上一世界第10关有星即解锁
    return this.getStars(w, l - 1) > 0;
  },

  addResult(w, l, stars) {
    const k = `${w},${l}`;
    this.data.levels[k] = Math.max(this.data.levels[k] || 0, stars);
    this.persist();
  },

  nextLevel() {
    for (let w = 0; w < 4; w++) {
      for (let l = 0; l < 10; l++) {
        if (!this.isUnlocked(w, l)) return null;
        if (this.getStars(w, l) === 0) return { w, l };
      }
    }
    return null;
  },

  totalStars() {
    let n = 0;
    for (const v of Object.values(this.data.levels)) n += v;
    return n;
  },

  setSetting(key, val) {
    this.data.settings[key] = val;
    this.persist();
  },

  markTutorialDone() { this.data.tutorialDone = true; this.persist(); },
};
