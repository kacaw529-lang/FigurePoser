/**
 * skeleton.js — 體型比例與正向運動學
 *
 * 全專案唯一的幾何真相來源：2D 拖拉編輯器、3D 預覽、STL 匯出都呼叫這裡。
 * 所有長度以「頭部半徑 = 1」為單位，最後在外層乘上實際頭圍即可縮放，
 * 因此改變尺寸不需要重建任何網格。
 *
 * 座標系：+Z 向上、+Y 為人偶面朝方向、−X 為人偶的左手邊
 * 角度：前後擺正值向前；外展正值向體側張開；手肘/膝蓋 0~150 皆為自然彎曲方向
 */

export const R = 1;                 // 頭半徑（基準單位）

export const P = {
  headR:     1.00,
  torsoW:    2.53,
  torsoD:    1.53,
  torsoH:    3.53,
  torsoR:    0.60,   // 軀幹圓角。上限為 min(寬,厚)/2；設得比 armR 大，肩部才收得進去
  armR:      0.53,
  legR:      0.65,
  upArm:     1.88,
  loArm:     1.77,
  upLeg:     2.35,
  loLeg:     2.24,
  foreScale: 1.00,   // 前臂／小腿與上臂／大腿同粗。
                     // 設成 1 時，關節處兩顆球半徑相同，圓柱與球正好相切，
                     // 銜接是平滑的；一旦不等於 1，較粗的那一端就會出現台階。
};

// ── 軀幹表面 ──────────────────────────────────────────────
// 圓角方塊等同「內縮方塊 ⊕ 半徑 rr 的球」。
// 給定 (x, y)，可直接算出頂面與底面的高度，用來把關節放到剛好不凸出的位置。
const surfZ = (x, y, top) => {
  const rr = P.torsoR;
  const ix = Math.max(0, Math.abs(x) - (P.torsoW / 2 - rr));
  const iy = Math.max(0, Math.abs(y) - (P.torsoD / 2 - rr));
  const d2 = ix * ix + iy * iy;
  const h = d2 >= rr * rr ? 0 : Math.sqrt(rr * rr - d2);
  return top ? (P.torsoH - rr) + h : rr - h;
};

/** 圓角方塊的有號距離（負值代表在軀幹內部），供測試與檢查使用 */
export function torsoSDF(p) {
  const rr = P.torsoR;
  const b = [P.torsoW / 2 - rr, P.torsoD / 2 - rr, P.torsoH / 2 - rr];
  const q = [
    Math.abs(p[0]) - b[0],
    Math.abs(p[1]) - b[1],
    Math.abs(p[2] - P.torsoH / 2) - b[2]
  ];
  const out = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
  return out + Math.min(Math.max(q[0], q[1], q[2]), 0) - rr;
}

// ── 骨架錨點 ──────────────────────────────────────────────
// 肩、髖的位置不寫死，而是由軀幹表面往內推一個關節半徑算出來，
// 這樣改動體型比例或圓角時，關節不會突然凸出體外。
const CLEAR = 0.02;                              // 額外留一點餘裕
P.shoulderX  = P.torsoW / 2 - P.armR * 0.55;     // 仍略微凸出體側，手臂才像從側面長出來
P.shoulderZ  = surfZ(P.shoulderX, 0, true) - P.armR - CLEAR;
P.hipX       = P.torsoW / 2 - P.legR * 1.15;
P.hipZ       = surfZ(P.hipX, 0, false) + P.legR + CLEAR;
// 頭：無脖子，直接埋入軀幹；樞紐放得夠深，傾斜到極限仍不會脫離
P.headPivotZ = P.torsoH - 0.50;
P.headDist   = 1.22;
export const HEAD_TILT_MAX = 30;

/**
 * 關節活動範圍。有兩個刻意收緊的地方：
 *
 * hipPitch 下限 −40°：人體髖伸展本來就只有 20~30 度，再大會讓大腿從軀幹背面穿出。
 *
 * waistPitch 上限 +20°：腰往前彎會把軀幹下半部轉到大腿上方，兩者互相穿插，
 * 背面就冒出一塊圓凸。實測凸起量幾乎只由這個角度決定（10° 以內為 0、
 * 20° 約 0.35 mm、40° 約 1.0 mm，以 30 mm 成品計）。往後仰則完全沒有這個問題。
 */
export const LIMITS = {
  rootPitch:  [-180, 180], rootRoll:  [-180, 180],
  waistPitch: [-45, 20],   waistTwist: [-50, 50],
  headPitch:  [-HEAD_TILT_MAX, HEAD_TILT_MAX],
  headRoll:   [-HEAD_TILT_MAX, HEAD_TILT_MAX],
  armPitch: [-180, 180], armOut: [-25, 120], armTwist: [-180, 180], elbow: [0, 150],
  hipPitch: [-40, 135],  hipOut: [-15, 90],  knee:  [0, 150]
};

/** 站姿全高（以頭半徑為單位） */
export const STANDING_H =
  (P.headPivotZ + P.headDist + P.headR) -
  (P.hipZ - P.upLeg - P.loLeg - P.legR * 0.88);

// ── 3×3 矩陣工具 ──────────────────────────────────────────
const D = Math.PI / 180;
export const deg = r => r / D;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const mul = (A, C) => A.map(r => [0, 1, 2].map(j =>
  r[0] * C[0][j] + r[1] * C[1][j] + r[2] * C[2][j]));
export const ap = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
export const tp = M => [
  [M[0][0], M[1][0], M[2][0]],
  [M[0][1], M[1][1], M[2][1]],
  [M[0][2], M[1][2], M[2][2]]];

export const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
export const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
export const Rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/** 旋轉順序 Ry(外展)·Rx(前後)·Rz(扭轉)。扭轉在最內層，才是沿肢體自身軸線自轉 */
export const rotM = (pitch, out, twist) =>
  mul(mul(Ry((out || 0) * D), Rx((pitch || 0) * D)), Rz((twist || 0) * D));

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

// ── 姿勢資料 ──────────────────────────────────────────────
export const KEYS = [
  'rootPitch', 'rootRoll', 'waistPitch', 'waistTwist', 'headPitch', 'headRoll',
  'armPitchL', 'armOutL', 'armTwistL', 'elbowL', 'hipPitchL', 'hipOutL', 'kneeL',
  'armPitchR', 'armOutR', 'armTwistR', 'elbowR', 'hipPitchR', 'hipOutR', 'kneeR'
];
export const LR_KEYS = ['armPitch', 'armOut', 'armTwist', 'elbow', 'hipPitch', 'hipOut', 'knee'];

export const emptyPose = () => KEYS.reduce((o, k) => (o[k] = 0, o), {});

/** 把所有欄位收進活動範圍內。預設動作、貼上的姿勢代碼都會經過這裡 */
export function clampPose(pose) {
  for (const k of KEYS) {
    const lim = LIMITS[/[LR]$/.test(k) ? k.slice(0, -1) : k];
    if (lim) pose[k] = clamp(pose[k], lim[0], lim[1]);
  }
  return pose;
}
export const clonePose = src => clampPose(KEYS.reduce((o, k) => (o[k] = (src && k in src) ? +src[k] : 0, o), {}));

/**
 * 正向運動學
 * @returns {{joints:Object, parts:Array}} joints 供拖拉反解使用；parts 供繪製與建模
 */
export function fk(pose) {
  // rootPitch / waistPitch 取負號。
  // 四肢預設朝下(−Z)，正的 Rx 會把它們往前(+Y)擺；
  // 但軀幹與頭是朝上(+Z)的，同樣的正 Rx 反而會把它們往後倒。
  // 為了讓「全身前傾」「腰・前彎」這兩根滑桿的正值真的是往前，這裡先取負。
  const Mroot  = rotM(-pose.rootPitch, pose.rootRoll, 0);
  const Mwaist = mul(Mroot, rotM(-pose.waistPitch, 0, pose.waistTwist));

  const J = { Mroot, Mwaist };
  J.pelvis    = [0, 0, 0];
  J.headPivot = ap(Mwaist, [0, 0, P.headPivotZ]);
  J.Mhead     = mul(Mwaist, rotM(-pose.headPitch, pose.headRoll, 0));
  J.head      = add(J.headPivot, ap(J.Mhead, [0, 0, P.headDist]));

  for (const s of ['L', 'R']) {
    const sx = (s === 'L') ? -1 : 1;

    const sh  = ap(Mwaist, [sx * P.shoulderX, 0, P.shoulderZ]);
    const Mup = mul(Mwaist, rotM(pose['armPitch' + s], -sx * pose['armOut' + s], -sx * pose['armTwist' + s]));
    const el  = add(sh, ap(Mup, [0, 0, -P.upArm]));
    const Mfo = mul(Mup, Rx(pose['elbow' + s] * D));
    const hd  = add(el, ap(Mfo, [0, 0, -P.loArm]));

    const hp  = ap(Mroot, [sx * P.hipX, 0, P.hipZ]);
    const Mth = mul(Mroot, rotM(pose['hipPitch' + s], -sx * pose['hipOut' + s], 0));
    const kn  = add(hp, ap(Mth, [0, 0, -P.upLeg]));
    const Mca = mul(Mth, Rx(-pose['knee' + s] * D));
    const ft  = add(kn, ap(Mca, [0, 0, -P.loLeg]));

    Object.assign(J, {
      ['shoulder' + s]: sh, ['Mup' + s]: Mup, ['elbow' + s]: el, ['Mfo' + s]: Mfo, ['hand' + s]: hd,
      ['hip' + s]: hp, ['Mth' + s]: Mth, ['knee' + s]: kn, ['Mca' + s]: Mca, ['foot' + s]: ft
    });
  }

  // 每個零件：id、所在關節座標系（R 旋轉、t 位移）
  const parts = [
    { id: 'torso',    R: Mwaist,  t: ap(Mwaist, [0, 0, P.torsoH / 2]) },
    { id: 'head',     R: J.Mhead, t: J.head },
    { id: 'upArmL',   R: J.MupL,  t: J.shoulderL },
    { id: 'loArmL',   R: J.MfoL,  t: J.elbowL },
    { id: 'upArmR',   R: J.MupR,  t: J.shoulderR },
    { id: 'loArmR',   R: J.MfoR,  t: J.elbowR },
    { id: 'upLegL',   R: J.MthL,  t: J.hipL },
    { id: 'loLegL',   R: J.McaL,  t: J.kneeL },
    { id: 'upLegR',   R: J.MthR,  t: J.hipR },
    { id: 'loLegR',   R: J.McaR,  t: J.kneeR }
  ];
  return { joints: J, parts };
}

/** 各段的粗細與長度，給網格產生器用 */
export const SEGMENTS = {
  upArmL: { r: P.armR, len: P.upArm }, loArmL: { r: P.armR * P.foreScale, len: P.loArm },
  upArmR: { r: P.armR, len: P.upArm }, loArmR: { r: P.armR * P.foreScale, len: P.loArm },
  upLegL: { r: P.legR, len: P.upLeg }, loLegL: { r: P.legR * P.foreScale, len: P.loLeg },
  upLegR: { r: P.legR, len: P.upLeg }, loLegR: { r: P.legR * P.foreScale, len: P.loLeg }
};

// ── 拖曳反解 ──────────────────────────────────────────────
/** 兩自由度：由世界座標方向反推「前後擺」與「外展」 */
export function solve2(Mparent, dirWorld, sx) {
  const v = ap(tp(Mparent), norm(dirWorld));
  return {
    pitch: deg(Math.asin(clamp(v[1], -1, 1))),
    out: -deg(Math.atan2(-v[0], -v[2])) * sx
  };
}
/** 單自由度：投影到肢體可及的圓上，回傳彎曲角 */
export function solve1(Mparent, dirWorld) {
  const v = ap(tp(Mparent), norm(dirWorld));
  return deg(Math.atan2(v[1], -v[2]));
}
/** 頭部：先把方向限制在錐角內，再拆成 pitch / roll */
export function solveHead(Mwaist, dirWorld) {
  let v = ap(tp(Mwaist), norm(dirWorld));
  const tilt = Math.acos(clamp(v[2], -1, 1));
  const lim = HEAD_TILT_MAX * D;
  if (tilt > lim) {
    const s = Math.sin(tilt);
    const f = s > 1e-6 ? Math.sin(lim) / s : 0;
    v = norm([v[0] * f, v[1] * f, Math.cos(lim)]);
  }
  return {
    headPitch: deg(Math.asin(clamp(v[1], -1, 1))),
    headRoll: deg(Math.atan2(v[0], v[2]))
  };
}

/** 概略重心（依各段體積加權），用來判斷站不站得住 */
export function centerOfMass(J) {
  const seg = [
    [J.pelvis, ap(J.Mwaist, [0, 0, P.torsoH]), 3.4], [J.head, J.head, 1.6],
    [J.shoulderL, J.elbowL, 0.55], [J.elbowL, J.handL, 0.45],
    [J.shoulderR, J.elbowR, 0.55], [J.elbowR, J.handR, 0.45],
    [J.hipL, J.kneeL, 0.95], [J.kneeL, J.footL, 0.80],
    [J.hipR, J.kneeR, 0.95], [J.kneeR, J.footR, 0.80]
  ];
  let m = 0, c = [0, 0, 0];
  for (const [a, b, w] of seg) {
    m += w;
    c = [c[0] + (a[0] + b[0]) / 2 * w, c[1] + (a[1] + b[1]) / 2 * w, c[2] + (a[2] + b[2]) / 2 * w];
  }
  return [c[0] / m, c[1] / m, c[2] / m];
}

/** 所有端點，用於估算地面高度與支撐範圍 */
export function extremes(J) {
  return ['pelvis', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
    'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'].map(k => J[k]);
}

/**
 * 解析法外框：不依賴 3D 繪圖，也不受預覽分段數影響。
 * 人偶完全由球體與一個方塊組成，因此下列計算是精確值。
 * @returns {{min:number[], max:number[], size:number[]}} 單位為頭半徑
 */
export function boundingBox(pose) {
  const { joints: J } = fk(pose);
  const fs = P.foreScale;
  const spheres = [
    [J.head, P.headR],
    [J.shoulderL, P.armR], [J.elbowL, P.armR],
    [J.elbowL, P.armR * fs], [J.handL, P.armR * fs],
    [J.shoulderR, P.armR], [J.elbowR, P.armR],
    [J.elbowR, P.armR * fs], [J.handR, P.armR * fs],
    [J.hipL, P.legR], [J.kneeL, P.legR],
    [J.kneeL, P.legR * fs], [J.footL, P.legR * fs],
    [J.hipR, P.legR], [J.kneeR, P.legR],
    [J.kneeR, P.legR * fs], [J.footR, P.legR * fs]
  ];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const grow = (p, r) => {
    for (let i = 0; i < 3; i++) {
      if (p[i] - r < min[i]) min[i] = p[i] - r;
      if (p[i] + r > max[i]) max[i] = p[i] + r;
    }
  };
  for (const [c, r] of spheres) grow(c, r);
  // 軀幹是圓角方塊，等同「內縮方塊 ⊕ 半徑 rr 的球」。
  // 因此取內縮方塊的八個角、各自向外擴張 rr，旋轉後仍是精確值
  // （若直接用外框八角，軀幹一旋轉就會高估）。
  const rr = P.torsoR;
  const hw = P.torsoW / 2 - rr, hd = P.torsoD / 2 - rr;
  for (const x of [-hw, hw]) for (const y of [-hd, hd]) for (const z of [rr, P.torsoH - rr]) {
    grow(ap(J.Mwaist, [x, y, z]), rr);
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
