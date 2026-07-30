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
  torsoR:    0.72,   // 軀幹圓角。上限為 min(寬,厚)/2 = 0.765；設得比 armR 大，肩部才收得進去。
                     // 圓角越大，底部殘留的水平平面越小。這個平面一旦朝正下方又沒被腿遮住
                     // （跪坐就是這種情形），在切片軟體裡會變成一塊懸空的平板，看起來像多餘的底座。
                     // 0.60 時該平面有 4.22 mm²，0.72 只剩 0.94 mm²，0.765 則完全消失。
  armR:      0.53,
  legR:      0.65,
  upArm:     1.88,
  // 前臂/上臂 = 0.787，貼合成人實測的 0.785（上臂 0.186×身高、前臂 0.146×身高）。
  // 這個比值不受大頭 Q 版風格影響，是最乾淨的錨點。
  // 舊值 1.77 比值是 0.941，前臂相對長了 23%，視覺上手會顯得過長。
  loArm:     1.48,
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
// 頭：無脖子，直接埋入軀幹；樞紐放得夠深，傾斜到極限仍不會脫離。
// 樞紐深埋還有個好處：傾斜時頭心會往軀幹厚實處移動，重疊反而變多
// （±30° 時交界 3.68 mm，±45° 時 3.99 mm），所以錐角開到 45° 仍然安全。
// headDist 決定埋入多少：1.35 時交界圓約為頭直徑的 53%，
// 看起來是頭「坐」在肩上而不是陷進去，傾斜 30° 時頸部仍有約 4 mm（30 mm 成品）。
P.headPivotZ = P.torsoH - 0.50;
P.headDist   = 1.35;
export const HEAD_TILT_MAX = 45;

/** 肩關節往後伸展的上限（度）。人體約 50~60 */
export const SHOULDER_EXTENSION_MAX = 60;

/**
 * 關節活動範圍，依人體實際可動範圍（ROM）設定，數值取臨床常用區間的寬端。
 *
 *   肩・前後擺   屈曲 180 / 伸展 50~60      → [−60, 180]
 *   肩・外展     外展 180 / 內收 30~45      → [−40, 180]
 *   臂・扭轉     肩關節內外旋各約 90        → [−90, 90]
 *                （這個參數決定手肘往哪一側折；超過 90 就會變成手肘反折）
 *   肘           0~145，取 150
 *   髖・前後擺   屈曲 120~125 / 伸展 20~30  → [−30, 130]
 *   髖・外展     外展 45~50 / 內收 20~30    → [−30, 50]
 *   膝           0~135~150，取 150
 *   腰・前彎     胸腰段前彎 80~90 / 後仰 20~30 → [−30, 80]
 *   腰・扭轉     軀幹旋轉各約 35~45         → [−45, 45]
 *   頭・傾斜     頸部前彎 50 / 側彎 45      → 錐角 45（見 HEAD_TILT_MAX）
 *
 * rootPitch / rootRoll 不是人體關節，而是「整具人偶在世界中的擺放方向」，
 * 因此保留完整 360°：站、坐、躺、趴都靠它。
 *
 * 每一項都通過幾何驗證：範圍內髖球與肩球始終埋在軀幹裡、頭不會脫離。
 */
export const LIMITS = {
  rootPitch:  [-180, 180], rootRoll:   [-180, 180],
  waistPitch: [-30, 80],   waistTwist: [-45, 45],
  headPitch:  [-HEAD_TILT_MAX, HEAD_TILT_MAX],
  headRoll:   [-HEAD_TILT_MAX, HEAD_TILT_MAX],
  armPitch: [-60, 180], armOut: [-40, 180], armTwist: [-90, 90], elbow: [0, 150],
  hipPitch: [-30, 130], hipOut: [-30, 50],  knee:  [0, 150]
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

/**
 * 肩關節的可及方向不是「前後擺 × 外展」兩個獨立區間，而是球面上的一塊區域。
 * 往前、往側都可以一路舉到頭頂（180°），但往後只能伸展約 60°。
 * 用兩個區間分別限制等於畫了一個方盒，會放行「同時後伸 60° 又外展 179°」
 * 這種算出來手臂指向正後上方的組合——人體做不到。
 *
 * 這裡直接限制方向本身：以「離正下方的仰角 θ」與「方位角 φ」表示，
 *   φ = 0 為正前、90 為正側、180 為正後
 *   θ 上限 = φ ≤ 90 時 180；φ 從 90 到 180 之間，由 180 線性收到 60
 *
 * @param {number[]} v 軀幹座標系下的上臂單位方向
 * @returns {number[]} 修正後的方向（未超出時原樣回傳同一個陣列）
 */
export function clampArmSwing(v) {
  if (Math.hypot(v[0], v[1]) < 1e-9) return v;        // 正上或正下，沒有方位可言
  const theta = deg(Math.acos(clamp(-v[2], -1, 1)));
  const azRad = Math.atan2(v[0], v[1]);
  const az = Math.abs(deg(azRad));
  const thetaMax = az <= 90
    ? 180
    : 180 - (180 - SHOULDER_EXTENSION_MAX) * (az - 90) / 90;
  if (theta <= thetaMax) return v;
  const t = thetaMax * D, s = Math.sin(t);
  return [s * Math.sin(azRad), s * Math.cos(azRad), -Math.cos(t)];
}

const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;

/** 把所有欄位收進活動範圍內。預設動作、拖曳結果、貼上的姿勢代碼都會經過這裡 */
export function clampPose(pose) {
  for (const k of KEYS) {
    const lim = LIMITS[/[LR]$/.test(k) ? k.slice(0, -1) : k];
    if (lim) pose[k] = clamp(pose[k], lim[0], lim[1]);
  }

  // 逐一檢查兩隻手臂的指向是否落在肩關節可及的區域內
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const p = pose['armPitch' + side] * D;
    const o = -sx * pose['armOut' + side] * D;
    const v = [-Math.cos(p) * Math.sin(o), Math.sin(p), -Math.cos(p) * Math.cos(o)];
    const c = clampArmSwing(v);
    if (c === v) continue;

    // 同一個方向有兩組等價的 (前後擺, 外展)：(p, o) 與 (180−p, o+180)。
    // 不能只比參數距離——比較近的那支可能一套上角度上限就被砍歪。
    // 所以兩支都先套限制，再比「實際得到的方向」離目標多遠。
    const pA = deg(Math.asin(clamp(c[1], -1, 1)));
    const oA = deg(Math.atan2(-c[0], -c[2]));
    const dirOf = (p2, o2) => {
      const pc = clamp(p2, LIMITS.armPitch[0], LIMITS.armPitch[1]) * D;
      const oc = -sx * clamp(-o2 * sx, LIMITS.armOut[0], LIMITS.armOut[1]) * D;
      return [-Math.cos(pc) * Math.sin(oc), Math.sin(pc), -Math.cos(pc) * Math.cos(oc)];
    };
    const err = (p2, o2) => {
      const d = dirOf(p2, o2);
      return Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]);
    };
    const cand = [[pA, oA], [wrap180(180 - pA), wrap180(oA + 180)]];
    const [pf, of_] = err(...cand[0]) <= err(...cand[1]) ? cand[0] : cand[1];

    pose['armPitch' + side] = clamp(pf, LIMITS.armPitch[0], LIMITS.armPitch[1]);
    pose['armOut' + side] = clamp(-of_ * sx, LIMITS.armOut[0], LIMITS.armOut[1]);
  }
  return pose;
}

/**
 * 關節陷入軀幹或頭部的深度（正值＝在裡面多深）。
 * 拖曳時用來否決「把手拖進身體裡」這種結果。
 */
export function bodyPenetration(joints, key) {
  const t = torsoSDF(ap(tp(joints.Mwaist), joints[key]));
  const h = Math.hypot(...sub(joints[key], joints.head)) - P.headR;
  return -Math.min(t, h);
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

    // 髖關節「位置」掛在軀幹座標系（Mwaist），而不是骨盆座標（Mroot）。
    // 髖球是埋在軀幹裡的，若位置固定在骨盆而軀幹隨腰旋轉，
    // 軀幹就會從球上轉開，把球露在體外——這正是大腿上端跑出身體的原因。
    // 但大腿的「方向」仍以骨盆為基準，所以彎腰不會連帶把腿甩動。
    const hp  = ap(Mwaist, [sx * P.hipX, 0, P.hipZ]);
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
/**
 * 手掌拖曳：同時解出「臂・扭轉」與「肘・彎曲」，讓前臂直接指向目標。
 *
 * 只解手肘的話，前臂只能在「既有扭轉所決定的那個平面」上繞圈。
 * 若扭轉是先前擺別的姿勢留下來的，那個平面就是歪的，
 * 拖出來的結果會像手肘往側面或反方向折——也就是看起來不合理的關節角度。
 *
 * 推導：上臂座標系 M_up = A · Rz(t)，其中 A 是扭轉之前的參考系。
 * 前臂方向 = A · Rz(t) · Rx(e) · (0,0,−1) = A · (−sin e·sin t, sin e·cos t, −cos e)
 * 因此把目標方向換算到 A 之下得到 u 後：
 *   e = acos(−u_z)              （與扭轉無關）
 *   t = atan2(−u_x, u_y)
 *
 * @param {number[][]} Mup 目前的上臂座標系
 * @param {number} currentTwist 目前的 armTwist 參數值
 * @param {number[]} dirWorld 從手肘指向目標的世界座標方向
 * @param {number} sx 左為 −1、右為 +1
 */
export function solveArmHand(Mup, currentTwist, dirWorld, sx) {
  const applied = -sx * currentTwist;                       // 實際套用在矩陣裡的扭轉
  const A = mul(Mup, Rz(-applied * D));                     // 扣掉扭轉，取回參考座標系
  const u = ap(tp(A), norm(dirWorld));
  const elbow = deg(Math.acos(clamp(-u[2], -1, 1)));
  const lateral = Math.hypot(u[0], u[1]);
  // 前臂與上臂共線時扭轉無意義，維持原值避免亂跳
  const twist = lateral < 1e-6 ? currentTwist : -deg(Math.atan2(-u[0], u[1])) * sx;
  return { twist, elbow };
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
