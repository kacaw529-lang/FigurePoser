/**
 * printability.js — 估算這個姿勢需要多少支撐
 *
 * 判準用 FDM 的通則：底面與水平夾角小於 45° 且下方是空的，才需要支撐。
 * 這個人偶的四肢都是膠囊，可以逐段解析，不必真的切層：
 *
 *   1. 軸線與水平夾角超過 45° 的肢體，底面自己撐得住 → 跳過
 *   2. 剩下的近水平段，沿底面往下打射線，看碰不碰到別的部位或平台
 *   3. 需支撐面積 ≈ 懸空長度 × 直徑 × cos(仰角)，也就是投影到水平面的面積
 *
 * 這裡算的是「物理上會不會垂」，不是「某套切片軟體會生成幾克支撐」——
 * 後者取決於門檻角度、支撐型式等設定，硬要對齊只會給出錯誤的精確感。
 *
 * 頭與軀幹不列入評估：它們的底面是設計本身就有的，學生也改不動；
 * 會列入的是學生真正控制得到的四肢擺放。
 */
import { fk, boundingBox, torsoSDF, ap, tp, P } from './skeleton.js';

/** 與水平夾角 45° 對應的門檻。cos(45°) ≈ 0.707 */
const FLAT_THRESHOLD = 0.707;
/** 取樣數。每段肢體切這麼多份 */
const SAMPLES = 24;

const SEGMENTS = [
  ['upArmL', '左上臂', 'shoulderL', 'elbowL', () => P.armR],
  ['loArmL', '左前臂', 'elbowL', 'handL', () => P.armR * P.foreScale],
  ['upArmR', '右上臂', 'shoulderR', 'elbowR', () => P.armR],
  ['loArmR', '右前臂', 'elbowR', 'handR', () => P.armR * P.foreScale],
  ['upLegL', '左大腿', 'hipL', 'kneeL', () => P.legR],
  ['loLegL', '左小腿', 'kneeL', 'footL', () => P.legR * P.foreScale],
  ['upLegR', '右大腿', 'hipR', 'kneeR', () => P.legR],
  ['loLegR', '右小腿', 'kneeR', 'footR', () => P.legR * P.foreScale]
];

/**
 * @param {object} pose
 * @param {number} headRadiusMM
 * @returns {{area:number, level:'none'|'light'|'heavy', parts:Array, label:string, detail:string}}
 */
export function analysePrintability(pose, headRadiusMM) {
  const s = headRadiusMM;
  const { joints: J } = fk(pose);
  const invWaist = tp(J.Mwaist);
  const ground = boundingBox(pose).min[2] * s;

  const segs = SEGMENTS.map(([key, name, ja, jb, radius]) => ({
    key, name,
    a: J[ja].map(v => v * s),
    b: J[jb].map(v => v * s),
    r: radius() * s
  }));
  const head = { c: J.head.map(v => v * s), r: P.headR * s };

  /** 這個點是否落在人偶實體內（可排除自己那一段） */
  const isSolid = (x, y, z, skipKey) => {
    if ((x - head.c[0]) ** 2 + (y - head.c[1]) ** 2 + (z - head.c[2]) ** 2 <= head.r ** 2) return true;
    for (const g of segs) {
      if (g.key === skipKey) continue;
      const abx = g.b[0] - g.a[0], aby = g.b[1] - g.a[1], abz = g.b[2] - g.a[2];
      const apx = x - g.a[0], apy = y - g.a[1], apz = z - g.a[2];
      let t = (apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      if (dx * dx + dy * dy + dz * dz <= g.r * g.r) return true;
    }
    return torsoSDF(ap(invWaist, [x / s, y / s, z / s])) <= 0;
  };

  // 容差與射線步長都跟著模型大小縮放，換尺寸時判定才一致
  const gapTolerance = 0.40 * s;
  const rayStep = Math.max(0.12, 0.10 * s);

  const parts = [];
  let area = 0;

  for (const g of segs) {
    const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
    if (len < 1e-6) continue;
    const dz = (g.b[2] - g.a[2]) / len;
    const flat = Math.sqrt(Math.max(0, 1 - dz * dz));   // cos(仰角)：1 = 水平，0 = 垂直
    if (flat < FLAT_THRESHOLD) continue;                // 夠陡，自己撐得住

    let hanging = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i + 0.5) / SAMPLES;
      const x = g.a[0] + (g.b[0] - g.a[0]) * t;
      const y = g.a[1] + (g.b[1] - g.a[1]) * t;
      const zBottom = g.a[2] + (g.b[2] - g.a[2]) * t - g.r * flat;
      if (zBottom - ground <= gapTolerance) continue;   // 幾乎貼著平台
      let blocked = false;
      for (let z = zBottom - rayStep; z > ground; z -= rayStep) {
        if (isSolid(x, y, z, g.key)) { blocked = true; break; }
      }
      if (!blocked) hanging++;
    }
    if (!hanging) continue;
    const hangLen = (hanging / SAMPLES) * len;
    const a = hangLen * 2 * g.r * flat;
    parts.push({ key: g.key, name: g.name, length: hangLen, area: a });
    area += a;
  }

  parts.sort((x, y) => y.area - x.area);

  // 門檻隨模型大小平方縮放：支撐面積本身就是面積量
  const scale = (s / 3.1) ** 2;
  const level = area < 3 * scale ? 'none' : area < 15 * scale ? 'light' : 'heavy';

  return { area, level, parts, ...describe(level, parts) };
}

/**
 * 敘述刻意保留「以目前姿態」這個前提，不寫成絕對結論。
 * 實際列印時常會在切片軟體裡改變擺放方向，那會得到完全不同的支撐需求。
 */
function describe(level, parts) {
  if (level === 'none') {
    return { label: '以目前姿態列印，應該不需要支撐', detail: '' };
  }
  const names = parts.slice(0, 2).map(p => p.name).join('、');
  const len = parts[0].length;
  if (level === 'light') {
    return {
      label: '以目前姿態列印，可能需要少量支撐',
      detail: `${names}略微懸空約 ${len.toFixed(0)} mm`
    };
  }
  return {
    label: '以目前姿態列印，可能需要支撐',
    detail: `${names}接近水平且下方懸空約 ${len.toFixed(0)} mm。把它往下擺、靠到身體或地面上可以減少支撐`
  };
}
