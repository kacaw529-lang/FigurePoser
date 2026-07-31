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

/** 肩關節往後伸展的上限（度）。手臂垂下往後伸展，人體約 50~60 */
export const SHOULDER_EXTENSION_MAX = 60;
/** 手臂平舉時往後的水平外展上限（度）。人體約 20~30 */
export const SHOULDER_HORIZ_EXTENSION_MAX = 30;

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
  // 後方的可及範圍分兩段：
  //   方位 90→120（正側往後 30°）：仰角上限由 180° 收到 90°（手臂只能到水平）
  //   方位 120→180（再往後到正後方）：仰角上限由 90° 收到 60°（垂下後伸的極限）
  // 早期只用單一直線，會放行「手臂水平往正後方伸」這種做不到的姿勢。
  const knee = 90 + SHOULDER_HORIZ_EXTENSION_MAX;
  const thetaMax = az <= 90 ? 180
    : az <= knee ? 180 - (180 - 90) * (az - 90) / SHOULDER_HORIZ_EXTENSION_MAX
    : 90 - (90 - SHOULDER_EXTENSION_MAX) * (az - knee) / (180 - knee);
  if (theta <= thetaMax) return v;
  const t = thetaMax * D, s = Math.sin(t);
  return [s * Math.sin(azRad), s * Math.cos(azRad), -Math.cos(t)];
}

const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

/** 由「前後擺 / 外展」算出肢體方向（所屬座標系下） */
const dirFromSwing = (pitch, out, sx) => {
  const p = pitch * D, o = -sx * out * D;
  return [-Math.cos(p) * Math.sin(o), Math.sin(p), -Math.cos(p) * Math.cos(o)];
};

/**
 * 在球面上從 dir0 往外一圈一圈搜尋，回傳最接近且通過 accept 的方向；找不到時回傳 null。
 * 由近而遠地找，修正量才會最小，使用者拖曳的意圖得以保留。
 */
function nearestAcceptableDir(dir0, accept) {
  if (accept(dir0)) return dir0;
  const helper = Math.abs(dir0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm(cross3(helper, dir0));
  const e2 = cross3(dir0, e1);
  for (let ring = 4; ring <= 160; ring += 4) {
    const t = ring * D, st = Math.sin(t), ct = Math.cos(t);
    for (let i = 0; i < 24; i++) {
      const ph = (i / 24) * 2 * Math.PI, cp = Math.cos(ph), sp = Math.sin(ph);
      const d = [
        dir0[0] * ct + (e1[0] * cp + e2[0] * sp) * st,
        dir0[1] * ct + (e1[1] * cp + e2[1] * sp) * st,
        dir0[2] * ct + (e1[2] * cp + e2[2] * sp) * st
      ];
      if (accept(d)) return d;
    }
  }
  return null;                       // 完全找不到；呼叫端須自行退回安全值
}

/**
 * 把方向換算成「角度區間內真的表達得出來」的實際方向。
 * 搜尋時必須用這個結果做判斷，否則找到的方向會在寫回時被角度上限砍歪，
 * 修正等於白做。
 */
function snapDir(c, sx, pitchKey, outKey) {
  const lp = LIMITS[pitchKey], lo = LIMITS[outKey];
  const pA = deg(Math.asin(clamp(c[1], -1, 1)));
  const oA = deg(Math.atan2(-c[0], -c[2]));
  const make = (p2, o2) => {
    const pitch = clamp(p2, lp[0], lp[1]);
    const out = clamp(-o2 * sx, lo[0], lo[1]);
    return { pitch, out, dir: dirFromSwing(pitch, out, sx) };
  };
  const a = make(pA, oA), b = make(wrap180(180 - pA), wrap180(oA + 180));
  const err = r => Math.hypot(r.dir[0]-c[0], r.dir[1]-c[1], r.dir[2]-c[2]);
  return err(a) <= err(b) ? a : b;
}

/**
 * 把修正後的方向寫回 (前後擺, 外展)。
 * 同一個方向有兩組等價解 (p, o) 與 (180−p, o+180)，不能只比參數距離——
 * 比較近的那支可能一套上角度上限就被砍歪。兩支都先套限制，再比實際方向誰接近。
 */
function writeSwing(pose, side, pitchKey, outKey, c, sx) {
  const lp = LIMITS[pitchKey], lo = LIMITS[outKey];
  const pA = deg(Math.asin(clamp(c[1], -1, 1)));
  const oA = deg(Math.atan2(-c[0], -c[2]));
  const dirOf = (p2, o2) => {
    const pc = clamp(p2, lp[0], lp[1]);
    const oc = clamp(-o2 * sx, lo[0], lo[1]);
    return dirFromSwing(pc, oc, sx);
  };
  const err = (p2, o2) => {
    const d = dirOf(p2, o2);
    return Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]);
  };
  const cand = [[pA, oA], [wrap180(180 - pA), wrap180(oA + 180)]];
  const [pf, of_] = err(...cand[0]) <= err(...cand[1]) ? cand[0] : cand[1];
  pose[pitchKey + side] = clamp(pf, lp[0], lp[1]);
  pose[outKey + side] = clamp(-of_ * sx, lo[0], lo[1]);
}

/**
 * 關節球容許陷入身體的深度上限（佔自身半徑）。
 *
 * 這個值直接決定「手臂還剩多少露在體外」：
 *   陷入   0% → 球心剛好在表面上，露出 100%
 *   陷入  15% → 露出 85%      ← 目前值
 *   陷入  45% → 露出 55%
 *   陷入  80% → 露出 20%（手臂幾乎看不見了）
 *
 * 早期取 80% 是照著「八款預設最深 45%」往上留餘裕訂的，但那個推論反了——
 * 預設的值只說明哪些姿勢要保留，不代表更深也可以接受。
 * 身體是有厚度的，手肘球一往內，整條手臂就跟著埋進去。
 * 取 15% 等於要求手肘球心大致貼在身體輪廓上，再往內手臂就會消失。
 */
export const BALL_PENETRATION_MAX = 0.15;

/**
 * 肢體碰到「頭」的容許量比碰到軀幹寬鬆——「舉手抱頭」就是靠手掌沒入頭部一點來融接。
 * 01 舉手抱頭的手掌是 38%，取 0.50 留餘裕。
 */
export const HEAD_CONTACT_MAX = 0.50;

/**
 * 兩條大腿之間的容許重疊（佔腿半徑）。
 * 髖關節間距 1.035、腿半徑 0.65，雙腿併攏時本來就重疊 41%——
 * 這是造型的一部分，門檻必須高於它；明顯疊死的案例是 97~200%。
 */
export const THIGH_OVERLAP_MAX = 0.60;

/**
 * 手肘可以往身體中線靠多近（軀幹座標的內向座標，0 = 中線，負值 = 仍在自己那一側）。
 *
 * 這是關節活動範圍的限制，不是碰撞——手臂往前繞過胸前時手肘在體外，
 * 碰撞檢查不會抱怨，但肩關節的水平內收本來就到不了那麼遠。
 * 實測「抱胸」這種極限動作，手肘也只到 −0.12（還沒碰到中線），
 * 所以規則可以很乾脆：手肘不得越過中線。
 */
export const ELBOW_MIDLINE_MAX = 0;

/**
 * 膝蓋可以往中線靠多近。比手肘寬鬆一些——「兩腳交叉站」是常見動作，
 * 膝蓋確實會稍微越過中線，但越不過太多。
 */
export const KNEE_MIDLINE_MAX = 0.30;

/**
 * 兩條線段之間的最短距離（解析解）。
 * 只檢查膝蓋球對另一條大腿不夠——兩腿同時內收時膝蓋會互相錯開，
 * 但兩條大腿在中間交叉成 X，非得用線段對線段才抓得到。
 */
const segSegDist = (p1, q1, p2, q2) => {
  const d1 = [q1[0]-p1[0], q1[1]-p1[1], q1[2]-p1[2]];
  const d2 = [q2[0]-p2[0], q2[1]-p2[1], q2[2]-p2[2]];
  const r  = [p1[0]-p2[0], p1[1]-p2[1], p1[2]-p2[2]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s2, t2;
  if (a < 1e-12 && e < 1e-12) return Math.hypot(r[0], r[1], r[2]);
  if (a < 1e-12) { s2 = 0; t2 = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e < 1e-12) { t2 = 0; s2 = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s2 = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t2 = (b * s2 + f) / e;
      if (t2 < 0) { t2 = 0; s2 = clamp(-c / a, 0, 1); }
      else if (t2 > 1) { t2 = 1; s2 = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = [p1[0]+d1[0]*s2, p1[1]+d1[1]*s2, p1[2]+d1[2]*s2];
  const c2 = [p2[0]+d2[0]*t2, p2[1]+d2[1]*t2, p2[2]+d2[2]*t2];
  return Math.hypot(c1[0]-c2[0], c1[1]-c2[1], c1[2]-c2[2]);
};

/** 點到線段的距離（用於肢體之間的碰撞） */
const segDist = (p, a, b) => {
  const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
  const apx = p[0]-a[0], apy = p[1]-a[1], apz = p[2]-a[2];
  const d2 = abx*abx + aby*aby + abz*abz;
  let t = d2 > 1e-12 ? (apx*abx + apy*aby + apz*abz) / d2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(apx - abx*t, apy - aby*t, apz - abz*t);
};

/**
 * 關節陷入軀幹或頭部的深度（正值＝在裡面多深）。
 * 拖曳時用來否決「把手拖進身體裡」這種結果。
 */
export function bodyPenetration(joints, key) {
  const t = torsoSDF(ap(tp(joints.Mwaist), joints[key]));
  const h = Math.hypot(...sub(joints[key], joints.head)) - P.headR;
  return -Math.min(t, h);
}

/**
 * 把姿勢收進「人做得到」的範圍。四層，每層職責單一：
 *
 *   1. 角度區間      各關節的 ROM（LIMITS）
 *   2. 解剖學方向區域  只有肩關節後方那一塊——那裡沒有東西擋著，純粹是關節囊的限制
 *   3. 解剖學折彎基準  手肘一律往身體前方折（見 elbowTwistBase，屬結構而非限制）
 *   4. 碰撞修正      由近端往遠端跑一遍，直接檢查實際位置有沒有陷進身體
 *
 * 第 4 層取代了早期那些手工調出來的「內收上限」曲線。那些規則其實都在描述
 * 「身體擋住了」，用碰撞表達更直接；更重要的是它看得到**耦合**——
 * 腰部前彎會讓軀幹掃過大腿、頭部傾斜會讓頭撞到手肘，
 * 而 waistPitch / headPitch 都不是四肢自己的角度，任何針對四肢角度的限制都看不見。
 */
export function clampPose(pose) {
  // 第 1 層：角度區間
  for (const k of KEYS) {
    const lim = LIMITS[/[LR]$/.test(k) ? k.slice(0, -1) : k];
    if (lim) pose[k] = clamp(pose[k], lim[0], lim[1]);
  }

  // 身體在「軀幹座標」下的樣子：軀幹用 torsoSDF，頭是一顆球
  const Mh = rotM(-pose.headPitch, pose.headRoll, 0);
  const headC = [
    Mh[0][2] * P.headDist,
    Mh[1][2] * P.headDist,
    P.headPivotZ + Mh[2][2] * P.headDist
  ];
  // 軀幹與頭分開判斷：碰到軀幹幾乎不允許（手臂會消失），碰到頭則寬鬆一些
  const bodyOK = (pWaist, r) =>
    -torsoSDF(pWaist) / r <= BALL_PENETRATION_MAX &&
    (P.headR - Math.hypot(pWaist[0] - headC[0], pWaist[1] - headC[1], pWaist[2] - headC[2])) / r
      <= HEAD_CONTACT_MAX;

  // 第 2＋4 層：手臂。肩關節後方區域（解剖）與手肘球不得陷入身體（幾何）一起判斷，
  // 在兩者的交集上找最接近原方向的解。
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = [sx * P.shoulderX, 0, P.shoulderZ];
    const v = dirFromSwing(pose['armPitch' + side], pose['armOut' + side], sx);
    const accept = d => {
      const s2 = snapDir(d, sx, 'armPitch', 'armOut');                 // 只認角度區間表達得出來的方向
      if (clampArmSwing(s2.dir) !== s2.dir) return false;              // 落在肩關節可及區域外
      const e = [shoulder[0] + s2.dir[0] * P.upArm, shoulder[1] + s2.dir[1] * P.upArm, shoulder[2] + s2.dir[2] * P.upArm];
      if (-sx * e[0] > ELBOW_MIDLINE_MAX) return false;      // 手肘越過身體中線
      return bodyOK(e, P.armR);
    };
    if (!accept(v)) {
      const c = nearestAcceptableDir(clampArmSwing(v), accept);
      if (c) {
        const s2 = snapDir(c, sx, 'armPitch', 'armOut');
        pose['armPitch' + side] = s2.pitch;
        pose['armOut' + side] = s2.out;
      } else {
        pose['armOut' + side] = 0;          // 找不到就先收回中立位，避免卡在錯的地方
      }
    }
  }

  // 第 4 層：腿。膝蓋球除了身體，還要避開另一條大腿——否則兩腿會疊在一起。
  // 兩腿同時內收時，若各自只對照「對方原本的位置」，兩邊會往同一方向一起移動、
  // 結果仍然重疊；因此改成反覆數輪、每輪都用對方的最新位置，逐步把彼此推開。
  {
    const W = rotM(-pose.waistPitch, 0, pose.waistTwist);   // 軀幹相對骨盆
    const Wt = tp(W);
    const hipRoot = sx => ap(W, [sx * P.hipX, 0, P.hipZ]);
    const kneeRoot = (sx, d) => {
      const h = hipRoot(sx);
      return [h[0] + d[0] * P.upLeg, h[1] + d[1] * P.upLeg, h[2] + d[2] * P.upLeg];
    };
    const dirOf = side => dirFromSwing(pose['hipPitch' + side], pose['hipOut' + side],
                                       side === 'L' ? -1 : 1);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? -1 : 1;
        const oSide = side === 'L' ? 'R' : 'L';
        const oSx = -sx;
        const oHip = hipRoot(oSx);
        const oKnee = kneeRoot(oSx, dirOf(oSide));
        const accept = d => {
          const s2 = snapDir(d, sx, 'hipPitch', 'hipOut');
          const k = kneeRoot(sx, s2.dir);
          // 腿接在骨盆上，所以中線要以骨盆座標為準；用軀幹座標的話，
          // 腰一扭轉就會把原本正常的腿判成越線
          if (-sx * k[0] > KNEE_MIDLINE_MAX) return false;
          if (!bodyOK(ap(Wt, k), P.legR)) return false;
          const hip = hipRoot(sx);
          const gap = segSegDist(hip, k, oHip, oKnee);   // 整條大腿對整條大腿
          return (2 * P.legR - gap) / P.legR <= THIGH_OVERLAP_MAX;
        };
        const cur = dirOf(side);
        if (accept(cur)) continue;
        const c = nearestAcceptableDir(cur, accept);
        if (c) {
          const s2 = snapDir(c, sx, 'hipPitch', 'hipOut');
          pose['hipPitch' + side] = s2.pitch;
          pose['hipOut' + side] = s2.out;
        } else {
          // 對側那條腿也越過中線時，兩邊會互相卡死而找不到任何解。
          // 先把這條收回中立位，下一輪對方就有空間可以修。
          pose['hipOut' + side] = 0;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  // 第 4 層（遠端）：前臂與小腿不得折進身體
  for (const side of ['L', 'R']) fixForearm(pose, side, headC);
  {
    const W = rotM(-pose.waistPitch, 0, pose.waistTwist);
    const Wt = tp(W);
    for (const side of ['L', 'R']) fixShin(pose, side, W, Wt, bodyOK);
  }
  return pose;
}

/**
 * 小腿折進身體的修正。
 * 膝蓋是單自由度、沒有扭轉可調，唯一的手段就是改變彎曲角度；
 * 從目前值往兩側搜尋最接近的可用值，修正量才最小。
 */
function fixShin(pose, side, W, Wt, bodyOK) {
  const sx = side === 'L' ? -1 : 1;
  const hip = ap(W, [sx * P.hipX, 0, P.hipZ]);
  const Mth = rotM(pose['hipPitch' + side], -sx * pose['hipOut' + side], 0);
  const knee = [
    hip[0] + Mth[0][2] * -P.upLeg,
    hip[1] + Mth[1][2] * -P.upLeg,
    hip[2] + Mth[2][2] * -P.upLeg
  ];
  const rShin = P.legR * P.foreScale;
  const ok = kneeDeg => {
    const M = mul(Mth, Rx(-kneeDeg * D));
    const dir = [-M[0][2], -M[1][2], -M[2][2]];
    for (let i = 4; i <= 16; i++) {          // 跳過靠近膝蓋的前段，那裡本來就與大腿相接
      const t = (i / 16) * P.loLeg;
      const p = [knee[0] + dir[0]*t, knee[1] + dir[1]*t, knee[2] + dir[2]*t];
      if (!bodyOK(ap(Wt, p), rShin)) return false;
    }
    return true;
  };
  const cur = pose['knee' + side];
  if (ok(cur)) return;
  const [lo, hi] = LIMITS.knee;
  for (let d = 5; d <= 150; d += 5) {
    for (const k of [cur - d, cur + d]) {
      if (k < lo || k > hi) continue;
      if (ok(k)) { pose['knee' + side] = k; return; }
    }
  }
}

/**
 * 前臂是否可接受。三個條件都要成立：
 *   1. 埋進軀幹的長度比例不超過上限（八款預設最高 34%，明顯穿透是 85~100%）
 *   2. 手掌陷進軀幹的深度與其他關節球用同一個門檻
 *   3. 手掌可以輕觸頭部（「舉手抱頭」靠這點融接），但不能整顆沒入
 * 只看比例會漏掉「前臂後半段連同手掌沒入身體」，三者要一起判斷。
 */
const FOREARM_BURIED_MAX = 0.55;
function forearmOK(elbow, dir, headC) {
  let inside = 0;
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * P.loArm;
    if (torsoSDF([elbow[0] + dir[0] * t, elbow[1] + dir[1] * t, elbow[2] + dir[2] * t]) < 0) inside++;
  }
  if (inside / (N + 1) > FOREARM_BURIED_MAX) return false;
  const hand = [elbow[0] + dir[0] * P.loArm, elbow[1] + dir[1] * P.loArm, elbow[2] + dir[2] * P.loArm];
  const rWrist = P.armR * P.foreScale;
  if (-torsoSDF(hand) > BALL_PENETRATION_MAX * rWrist) return false;
  const dh = Math.hypot(hand[0] - headC[0], hand[1] - headC[1], hand[2] - headC[2]);
  return P.headR - dh <= HEAD_CONTACT_MAX * rWrist;
}

/**
 * 前臂折進身體的修正。
 * 扭轉接近 ±90 時折彎方向轉到側面，對內側那一邊就是直接折進身體。
 * 沿著扭轉角往兩側搜尋最接近的可用值——只動扭轉，保留使用者要的手肘彎曲程度；
 * 真的無解才逐步減少彎曲。
 */
function fixForearm(pose, side, headC) {
  const sx = side === 'L' ? -1 : 1;
  const A = rotM(pose['armPitch' + side], -sx * pose['armOut' + side], 0);
  const base = elbowTwistBase(A);
  const shoulder = [sx * P.shoulderX, 0, P.shoulderZ];
  const elbow = [
    shoulder[0] + A[0][2] * -P.upArm,
    shoulder[1] + A[1][2] * -P.upArm,
    shoulder[2] + A[2][2] * -P.upArm
  ];
  const dirFor = (twistDeg, elbowDeg) => {
    const M = mul(mul(A, Rz(base + (-sx * twistDeg) * D)), Rx(elbowDeg * D));
    return [-M[0][2], -M[1][2], -M[2][2]];
  };
  const curTwist = pose['armTwist' + side];
  const curElbow = pose['elbow' + side];
  if (forearmOK(elbow, dirFor(curTwist, curElbow), headC)) return;

  const [lo, hi] = LIMITS.armTwist;
  for (let d = 5; d <= 180; d += 5) {
    for (const t of [curTwist + d, curTwist - d]) {
      if (t < lo || t > hi) continue;
      if (forearmOK(elbow, dirFor(t, curElbow), headC)) { pose['armTwist' + side] = t; return; }
    }
  }
  for (let e = curElbow - 10; e >= 0; e -= 10) {
    for (let d = 0; d <= 180; d += 5) {
      for (const t of d === 0 ? [curTwist] : [curTwist + d, curTwist - d]) {
        if (t < lo || t > hi) continue;
        if (forearmOK(elbow, dirFor(t, e), headC)) {
          pose['armTwist' + side] = t;
          pose['elbow' + side] = e;
          return;
        }
      }
    }
  }
  pose['elbow' + side] = 0;
}

export const clonePose = src => clampPose(KEYS.reduce((o, k) => (o[k] = (src && k in src) ? +src[k] : 0, o), {}));

/** 把 f 投影到垂直於 u 的平面上 */
const perp = (f, u) => {
  const d = f[0] * u[0] + f[1] * u[1] + f[2] * u[2];
  return [f[0] - d * u[0], f[1] - d * u[1], f[2] - d * u[2]];
};

/**
 * 手肘折彎方向的解剖學基準（回傳弧度）。
 *
 * 人的手肘一律往身體前方折：手臂垂著時往前、舉高時往前下、前平舉時往上（二頭彎舉）。
 * 但歐拉角分解出來的預設折彎方向，只有手臂垂著時才剛好正確——
 * 手臂舉高時整整差 180°，於是「扭轉 0」就變成手肘往後翻的馬腿姿勢。
 *
 * 這裡算出一個基準角，讓扭轉 0 永遠對應解剖學方向；
 * 扭轉參數因此變成「相對於自然折彎方向的偏移」，±90 的上限也就等於
 * 「折彎方向最多偏到側面，永遠不會翻到後面」——手肘反折在結構上就不可能發生。
 *
 * @param {number[][]} A 扭轉之前的上臂座標系（軀幹座標）
 */
export function elbowTwistBase(A) {
  const e1 = [A[0][0], A[1][0], A[2][0]];
  const e2 = [A[0][1], A[1][1], A[2][1]];
  const u  = [-A[0][2], -A[1][2], -A[2][2]];                       // 上臂朝向
  let b = perp([0, 1, 0], u);                                      // 軀幹正前方
  if (Math.hypot(b[0], b[1], b[2]) < 0.15) b = perp([0, 0, 1], u);  // 手臂指向正前或正後時改用上方
  b = norm(b);
  return Math.atan2(
    -(b[0] * e1[0] + b[1] * e1[1] + b[2] * e1[2]),
      b[0] * e2[0] + b[1] * e2[1] + b[2] * e2[2]);
}

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
    // 先算出「扭轉之前」的上臂座標系，取得解剖學折彎基準，再把使用者的扭轉疊上去
    const Alocal = rotM(pose['armPitch' + s], -sx * pose['armOut' + s], 0);
    const tBase = elbowTwistBase(Alocal);
    const Aup = mul(Mwaist, Alocal);
    const Mup = mul(Aup, Rz(tBase + (-sx * pose['armTwist' + s]) * D));
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
      ['shoulder' + s]: sh, ['Mup' + s]: Mup, ['Aup' + s]: Aup, ['twistBase' + s]: tBase,
      ['elbow' + s]: el, ['Mfo' + s]: Mfo, ['hand' + s]: hd,
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
 * @param {number[][]} Aup 扭轉之前的上臂座標系（fk 回傳的 AupL / AupR）
 * @param {number} twistBase 解剖學折彎基準角（弧度，fk 回傳的 twistBaseL / twistBaseR）
 * @param {number[]} dirWorld 從手肘指向目標的世界座標方向
 * @param {number} sx 左為 −1、右為 +1
 */
export function solveArmHand(Aup, twistBase, dirWorld, sx) {
  const u = ap(tp(Aup), norm(dirWorld));
  const elbow = deg(Math.acos(clamp(-u[2], -1, 1)));
  const lateral = Math.hypot(u[0], u[1]);
  if (lateral < 1e-6) return { twist: null, elbow };   // 與上臂共線，扭轉無意義
  const tTotal = Math.atan2(-u[0], u[1]);
  return { twist: -deg(tTotal - twistBase) * sx, elbow };
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
