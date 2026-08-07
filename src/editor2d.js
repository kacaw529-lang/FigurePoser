/**
 * editor2d.js — 正面／側面雙視圖拖拉編輯器
 *
 * 兩張正投影圖各自負責一組自由度：
 *   正面（鏡頭在 +Y）：畫面右 = −X，管左右張開
 *   側面（鏡頭在 +X）：畫面右 = +Y，管前後擺動
 * 拖曳時把滑鼠位置反投影回 3D（看不見的那一軸沿用目前值），
 * 再交給 skeleton.js 的反解函式換算成關節角度。
 */
import {
  fk, solve2, solve1, solveHead, centerOfMass, extremes,
  sub, clamp, ap, P, LR_KEYS, LIMITS, solveArmHand, clampPose, bodyPenetration
} from './skeleton.js';

/**
 * 取景參數。刻意固定不隨姿勢變動，換動作時畫面才不會忽大忽小；
 * 分母是「以頭半徑為單位的可視範圍」，最寬的大字型約佔 10.2，留一點邊。
 */
export const FRAME = { wDiv: 10.8, hDiv: 11.2, cyRatio: 0.60 };

const HANDLES = [
  { key: 'elbowL', side: 'L', type: 'arm2' }, { key: 'handL', side: 'L', type: 'arm1' },
  { key: 'elbowR', side: 'R', type: 'arm2' }, { key: 'handR', side: 'R', type: 'arm1' },
  { key: 'kneeL', side: 'L', type: 'leg2' }, { key: 'footL', side: 'L', type: 'leg1' },
  { key: 'kneeR', side: 'R', type: 'leg2' }, { key: 'footR', side: 'R', type: 'leg1' },
  { key: 'head', side: 'C', type: 'head' }
];

/** 拖曳的關節與其半徑、對應的關節座標鍵。用於「別把手拖進身體裡」的否決 */
const VETO = {
  arm2: [j => 'elbow' + j, () => P.armR],
  arm1: [j => 'hand' + j,  () => P.armR * P.foreScale],
  leg2: [j => 'knee' + j,  () => P.legR],
  leg1: [j => 'foot' + j,  () => P.legR * P.foreScale]
};

const COL = {
  L: '#3f86bd', R: '#d1673f', C: '#8a7d6d',
  limbL: '#dcebf6', limbR: '#fae3da', body: '#efe9e0', edge: '#c6bcac',
  ground: '#ded6c8', ok: '#4f9d69', bad: '#cf5b4a'
};

export class Editor2D {
  /**
   * @param {HTMLCanvasElement} frontCanvas
   * @param {HTMLCanvasElement} sideCanvas
   * @param {object} state  { pose, mirror }
   * @param {Function} onChange 姿勢變動後的回呼
   * @param {Function} [onBeginDrag] 按下控制點、還沒動到姿勢前的回呼（供復原記錄用）
   */
  constructor(frontCanvas, sideCanvas, state, onChange, onBeginDrag) {
    this.state = state;
    this.onChange = onChange;
    this.onBeginDrag = onBeginDrag || (() => {});
    this.views = [
      { cv: frontCanvas, id: 'front', px: p => -p[0], depth: p => p[1] },
      { cv: sideCanvas, id: 'side', px: p => p[1], depth: p => p[0] }
    ];
    this.views.forEach(v => {
      v.ctx = v.cv.getContext('2d');
      this._bindDrag(v);
    });
    this.drag = null;
    this.stable = true;
    this.highlight = new Set();   // 需要支撐的肢體代號，會被畫成虛線提醒
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const v of this.views) {
      const r = v.cv.getBoundingClientRect();
      if (!r.width) continue;
      v.cv.width = Math.round(r.width * dpr);
      v.cv.height = Math.round(r.height * dpr);
      v.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      v.w = r.width; v.h = r.height;
      v.scale = Math.min(v.w / FRAME.wDiv, v.h / FRAME.hDiv);
      v.cx = v.w / 2;
      v.cy = v.h * FRAME.cyRatio;
      v.ox = 0; v.oy = 0;
    }
  }

  _toScreen(v, p) {
    return [v.cx + v.ox + v.px(p) * v.scale, v.cy + v.oy - p[2] * v.scale];
  }

  /**
   * 人偶在畫面上實際佔的範圍（含肢體粗細）。
   * 用來把超出邊界的部分推回畫面內。
   */
  _figureBounds(v, J) {
    const s = v.scale;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const add = (p, r) => {
      const q = this._toScreen(v, p), rp = r * s;
      if (q[0] - rp < minX) minX = q[0] - rp;
      if (q[0] + rp > maxX) maxX = q[0] + rp;
      if (q[1] - rp < minY) minY = q[1] - rp;
      if (q[1] + rp > maxY) maxY = q[1] + rp;
    };
    add(J.head, P.headR);
    const fs = P.foreScale;
    for (const side of ['L', 'R']) {
      add(J['shoulder' + side], P.armR); add(J['elbow' + side], P.armR);
      add(J['hand' + side], P.armR * fs);
      add(J['hip' + side], P.legR);      add(J['knee' + side], P.legR);
      add(J['foot' + side], P.legR * fs);
    }
    // 軀幹是圓角方塊：取內縮方塊的八個角再外擴圓角半徑
    const rr = P.torsoR, hw = P.torsoW / 2 - rr, hd = P.torsoD / 2 - rr;
    for (const x of [-hw, hw]) for (const y of [-hd, hd]) for (const z of [rr, P.torsoH - rr])
      add(ap(J.Mwaist, [x, y, z]), rr);
    return { minX, maxX, minY, maxY };
  }

  /**
   * 算出把人偶推回畫面內所需的位移。
   * 取景刻意不隨姿勢縮放（換動作時忽大忽小反而不好瞄準），
   * 但骨盆固定在畫面 60% 高度處只適合站姿——整體前傾 180° 時身體往下長就會超出下緣。
   * 因此保留固定比例，只在真的超出邊界時才平移，站姿等常見情形位移為 0、完全不動。
   */
  _clampOffset(v, J) {
    const m = 4;                       // 邊界留白（像素）
    v.ox = 0; v.oy = 0;
    const b = this._figureBounds(v, J);
    const fit = (lo, hi, size) => {
      if (hi - lo > size - 2 * m) return (size - (lo + hi)) / 2;   // 裝不下就居中
      if (lo < m) return m - lo;
      if (hi > size - m) return size - m - hi;
      return 0;
    };
    v.ox = fit(b.minX, b.maxX, v.w);
    v.oy = fit(b.minY, b.maxY, v.h);
  }

  /** 把世界座標的「方向向量」投影成畫面上的 2D 方向（px 是線性的，可直接套用） */
  _dir(v, d) { return [v.px(d) * v.scale, -d[2] * v.scale]; }

  /**
   * 軀幹在畫面上的長方形。
   * 軀幹是方塊不是膠囊，用粗線加圓端點畫會變成一顆蛋
   * （正面線寬 2.53、線長 3.53，兩端圓帽就吃掉 72% 的長度）。
   * 這裡改成算出方塊投影後的長寬與傾角，再畫真正的圓角矩形。
   */
  _torsoRect(v, J) {
    const M = J.Mwaist;
    const axes = [
      { d: [M[0][0], M[1][0], M[2][0]], len: P.torsoW },
      { d: [M[0][1], M[1][1], M[2][1]], len: P.torsoD },
      { d: [M[0][2], M[1][2], M[2][2]], len: P.torsoH }
    ].map(a => {
      const s = this._dir(v, a.d);
      return { ...a, s, weight: Math.hypot(s[0], s[1]) * a.len };
    });

    // 以投影後最長的那根軸當作矩形的長邊方向
    const main = axes.reduce((a, b) => (a.weight > b.weight ? a : b));
    const n = Math.hypot(main.s[0], main.s[1]) || 1;
    const u = [main.s[0] / n, main.s[1] / n];
    const p = [-u[1], u[0]];

    // 投影後方塊在 u / p 兩個方向的實際範圍
    let L = 0, W = 0;
    for (const a of axes) {
      L += Math.abs(a.s[0] * u[0] + a.s[1] * u[1]) * a.len;
      W += Math.abs(a.s[0] * p[0] + a.s[1] * p[1]) * a.len;
    }
    const center = this._toScreen(v, ap(M, [0, 0, P.torsoH / 2]));
    const r = Math.min(P.torsoR * v.scale, W / 2, L / 2);
    return { center, L, W, r, ang: Math.atan2(u[1], u[0]) };
  }

  /** 由畫面座標反推 3D 位置，看不見的那一軸沿用 keep */
  _fromScreen(v, sx, sy, keep) {
    const z = (v.cy + v.oy - sy) / v.scale;
    const a = (sx - v.cx - v.ox) / v.scale;
    return v.id === 'front' ? [-a, keep[1], z] : [keep[0], a, z];
  }

  _bindDrag(v) {
    const local = e => {
      const r = v.cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    v.cv.addEventListener('pointerdown', e => {
      const [x, y] = local(e);
      const h = this._pick(v, x, y);
      if (!h) return;
      this.onBeginDrag();          // 先讓外部記下這一步之前的狀態
      this.drag = { v, h };
      v.cv.setPointerCapture(e.pointerId);
      v.cv.classList.add('dragging');
      e.preventDefault();
    });
    v.cv.addEventListener('pointermove', e => {
      if (!this.drag || this.drag.v !== v) return;
      const [x, y] = local(e);
      this._apply(v, this.drag.h, x, y);
      e.preventDefault();
    });
    const end = () => {
      if (this.drag && this.drag.v === v) {
        this.drag = null;
        v.cv.classList.remove('dragging');
        this.draw();          // 拖曳中不重算邊界位移，放開後補畫一次
      }
    };
    v.cv.addEventListener('pointerup', end);
    v.cv.addEventListener('pointercancel', end);
  }

  _pick(v, x, y) {
    const { joints } = fk(this.state.pose);
    let best = null, bd = 28;
    for (const h of HANDLES) {
      const p = this._toScreen(v, joints[h.key]);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  _apply(v, h, x, y) {
    const pose = this.state.pose;
    const { joints: J } = fk(pose);
    const target = this._fromScreen(v, x, y, J[h.key]);
    const s = h.side, sx = s === 'L' ? -1 : 1, other = s === 'L' ? 'R' : 'L';
    const mir = this.state.mirror;

    const lim = (key, v) => Math.round(clamp(v, LIMITS[key][0], LIMITS[key][1]));

    // 先記下會被改動的欄位與目前的陷入深度，必要時可以整組退回
    const vetoDef = VETO[h.type];
    const before = { values: {}, depth: -Infinity };
    if (vetoDef) {
      for (const k of LR_KEYS) for (const t of ['L', 'R']) before.values[k + t] = pose[k + t];
      before.depth = bodyPenetration(J, vetoDef[0](s));
    }

    if (h.type === 'arm2') {
      const r = solve2(J.Mwaist, sub(target, J['shoulder' + s]), sx);
      pose['armPitch' + s] = lim('armPitch', r.pitch);
      pose['armOut' + s] = lim('armOut', r.out);
    } else if (h.type === 'arm1') {
      // 手掌同時決定扭轉與彎曲，前臂才會真的指向拖曳的位置
      const r = solveArmHand(J['Aup' + s], J['twistBase' + s], sub(target, J['elbow' + s]), sx);
      if (r.twist !== null) pose['armTwist' + s] = lim('armTwist', r.twist);
      pose['elbow' + s] = lim('elbow', r.elbow);
    } else if (h.type === 'leg2') {
      const r = solve2(J.Mroot, sub(target, J['hip' + s]), sx);
      pose['hipPitch' + s] = lim('hipPitch', r.pitch);
      pose['hipOut' + s] = lim('hipOut', r.out);
    } else if (h.type === 'leg1') {
      pose['knee' + s] = lim('knee', -solve1(J['Mth' + s], sub(target, J['knee' + s])));
    } else if (h.type === 'head') {
      const r = solveHead(J.Mwaist, sub(target, J.headPivot));
      pose.headPitch = Math.round(r.headPitch);
      pose.headRoll = Math.round(r.headRoll);
    }

    if (mir && s !== 'C') LR_KEYS.forEach(k => { pose[k + other] = pose[k + s]; });

    // 肩關節的可及方向不是方盒，交給 clampPose 把不合人體的組合修回來
    clampPose(pose);

    // 若這一步把關節整顆推進身體內部，就退回上一個狀態。
    // 只有「變得更深」才否決，這樣即使目前已經卡在裡面也拖得出來。
    const veto = VETO[h.type];
    if (veto) {
      const key = veto[0](s), radius = veto[1]();
      const after = bodyPenetration(fk(pose).joints, key);
      if (after > radius && after > before.depth) Object.assign(pose, before.values);
    }

    this.onChange();
  }

  /** 回傳 { stable, groundZ, com }，供外部顯示狀態 */
  draw() {
    const pose = this.state.pose;
    const { joints: J } = fk(pose);
    const pts = extremes(J);
    const groundZ = Math.min(...pts.map(p => p[2])) - P.legR * 0.9;
    const com = centerOfMass(J);

    const low = pts.filter(p => p[2] < groundZ + 1.1);
    let stable = false;
    if (low.length) {
      const xs = low.map(p => p[0]), ys = low.map(p => p[1]), pad = 0.38;
      stable = com[0] > Math.min(...xs) - pad && com[0] < Math.max(...xs) + pad &&
        com[1] > Math.min(...ys) - pad && com[1] < Math.max(...ys) + pad;
    }
    this.stable = stable;

    for (const v of this.views) {
      if (!v.w) continue;
      // 拖曳中不重算位移，控制點才不會在手指底下滑掉
      if (!this.drag) this._clampOffset(v, J);
      const g = v.ctx;
      g.clearRect(0, 0, v.w, v.h);

      const gy = v.cy + v.oy - groundZ * v.scale;
      g.strokeStyle = COL.ground; g.lineWidth = 1;
      g.beginPath(); g.moveTo(6, gy); g.lineTo(v.w - 6, gy); g.stroke();

      const parts = [
        { a: J.pelvis, b: torsoTop(J), torso: true, c: COL.body },
        { key: 'upArmL', a: J.shoulderL, b: J.elbowL, w: P.armR * 2, c: COL.limbL },
        { key: 'loArmL', a: J.elbowL, b: J.handL, w: P.armR * 1.84, c: COL.limbL },
        { key: 'upArmR', a: J.shoulderR, b: J.elbowR, w: P.armR * 2, c: COL.limbR },
        { key: 'loArmR', a: J.elbowR, b: J.handR, w: P.armR * 1.84, c: COL.limbR },
        { key: 'upLegL', a: J.hipL, b: J.kneeL, w: P.legR * 2, c: COL.limbL },
        { key: 'loLegL', a: J.kneeL, b: J.footL, w: P.legR * 1.84, c: COL.limbL },
        { key: 'upLegR', a: J.hipR, b: J.kneeR, w: P.legR * 2, c: COL.limbR },
        { key: 'loLegR', a: J.kneeR, b: J.footR, w: P.legR * 1.84, c: COL.limbR }
      ];

      parts.sort((m, n) => (v.depth(m.a) + v.depth(m.b)) - (v.depth(n.a) + v.depth(n.b)));

      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const pt of parts) {
        if (pt.torso) {
          const t = this._torsoRect(v, J);
          g.save();
          g.translate(t.center[0], t.center[1]);
          g.rotate(t.ang + Math.PI / 2);   // 讓矩形長邊對齊 u
          roundRectPath(g, -t.W / 2, -t.L / 2, t.W, t.L, t.r);
          g.fillStyle = pt.c; g.fill();
          g.strokeStyle = COL.edge; g.lineWidth = 1.6; g.stroke();
          g.restore();
          continue;
        }
        const A = this._toScreen(v, pt.a), C = this._toScreen(v, pt.b);
        g.strokeStyle = COL.edge; g.lineWidth = pt.w * v.scale + 2.5;
        g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke();
        g.strokeStyle = pt.c; g.lineWidth = pt.w * v.scale;
        g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke();
        // 需要支撐的肢體加一圈虛線輪廓，讓學生知道該拖哪一段
        if (pt.key && this.highlight.has(pt.key)) {
          g.save();
          g.strokeStyle = COL.bad;
          g.lineWidth = 1.8;
          g.setLineDash([5, 4]);
          g.lineCap = 'butt';
          g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke();
          g.restore();
          g.lineCap = 'round';
        }
      }

      const hd = this._toScreen(v, J.head);
      g.fillStyle = COL.body; g.strokeStyle = COL.edge; g.lineWidth = 1.6;
      g.beginPath(); g.arc(hd[0], hd[1], P.headR * v.scale, 0, 7); g.fill(); g.stroke();

      // 重心垂線與落點
      const cmx = v.cx + v.ox + v.px(com) * v.scale;
      g.strokeStyle = stable ? COL.ok : COL.bad;
      g.setLineDash([3, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cmx, v.cy + v.oy - com[2] * v.scale); g.lineTo(cmx, gy); g.stroke();
      g.setLineDash([]); g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cmx - 6, gy - 6); g.lineTo(cmx + 6, gy + 6);
      g.moveTo(cmx + 6, gy - 6); g.lineTo(cmx - 6, gy + 6);
      g.stroke();

      // 控制點
      for (const h of HANDLES) {
        const p = this._toScreen(v, J[h.key]);
        const big = h.type.endsWith('2') || h.type === 'head';
        g.fillStyle = COL[h.side];
        g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(p[0], p[1], big ? 8.5 : 7, 0, 7); g.fill(); g.stroke();
      }
    }
    return { stable, groundZ, com };
  }
}

/** 圓角矩形路徑。舊瀏覽器沒有 ctx.roundRect，這裡自己畫 */
function roundRectPath(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function torsoTop(J) {
  const M = J.Mwaist;
  return [M[0][2] * P.torsoH, M[1][2] * P.torsoH, M[2][2] * P.torsoH];
}
