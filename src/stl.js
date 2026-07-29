/**
 * stl.js — 產生列印用網格並輸出二進位 STL
 *
 * 這裡自己寫匯出器而不用 three 的 STLExporter，理由有三：
 *   1. 球體與膠囊的極點會產生面積為零的退化三角形，這裡直接濾掉
 *   2. 匯出時順便算出「真實頂點外框」，回報的尺寸就是切片軟體會看到的數字
 *   3. 少一個相依檔案
 *
 * 各部位是彼此重疊的獨立封閉實體，不做布林聯集。
 * Cura、PrusaSlicer、Bambu Studio、Orca 等切片軟體在切片階段
 * 會自動把重疊實體聯集，結果與真聯集相同。
 */
import * as THREE from 'three';
import { buildGeometries, disposeGeometries, buildFigure, applyPose, makeBaseMM, BASE_THICKNESS } from './meshes.js';
import { fk } from './skeleton.js';

/**
 * 依「弦高誤差」決定圓周分段數，並套一個下限。
 * 半徑 r 的圓分成 n 段時，弦與弧的最大偏差約 r·(1−cos(π/n))。
 * 只看誤差的話，小模型會算出很少的段數（3 mm 的頭在 0.05 mm 誤差下只有 18 段），
 * 幾何上夠精確，但肉眼與切片軟體的平面著色都看得出稜角，所以另外加下限。
 */
export function segmentsFor(radiusMM, toleranceMM, floor = 24) {
  const n = Math.PI / Math.acos(Math.max(-1, 1 - toleranceMM / Math.max(radiusMM, 1e-6)));
  return Math.max(floor, Math.min(160, Math.ceil(n / 2) * 2));
}

/** 把場景裡所有網格攤平成世界座標的三角形陣列，同時濾掉退化面 */
function collectTriangles(root) {
  root.updateMatrixWorld(true);
  const tris = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  let skipped = 0;

  root.traverse(obj => {
    if (!obj.isMesh) return;
    const g = obj.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const m = obj.matrixWorld;
    const count = idx ? idx.count : pos.count;

    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i)     : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m);

      ab.subVectors(b, a); ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      if (n.lengthSq() < 1e-16) { skipped++; continue; }   // 極點的零面積三角形
      n.normalize();

      tris.push(n.x, n.y, n.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (const v of [a, b, c]) {
        if (v.x < min[0]) min[0] = v.x;  if (v.x > max[0]) max[0] = v.x;
        if (v.y < min[1]) min[1] = v.y;  if (v.y > max[1]) max[1] = v.y;
        if (v.z < min[2]) min[2] = v.z;  if (v.z > max[2]) max[2] = v.z;
      }
    }
  });
  return { tris, min, max, count: tris.length / 12, skipped };
}

/** 把位移直接套用到頂點上（底座之後要以最終座標接上去，不能再共用一個位移） */
function shift(tris, count, off) {
  for (let t = 0; t < count; t++) {
    const p = t * 12;
    for (let v = 0; v < 3; v++) {
      tris[p + 3 + v * 3] += off[0];
      tris[p + 4 + v * 3] += off[1];
      tris[p + 5 + v * 3] += off[2];
    }
  }
}

/** 寫成二進位 STL */
function writeBinarySTL(tris, count, offset) {
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const header = '3D figure poser';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, count, true);

  let o = 84;
  for (let t = 0; t < count; t++) {
    const p = t * 12;
    dv.setFloat32(o,     tris[p],     true);
    dv.setFloat32(o + 4, tris[p + 1], true);
    dv.setFloat32(o + 8, tris[p + 2], true);
    o += 12;
    for (let v = 0; v < 3; v++) {
      dv.setFloat32(o,     tris[p + 3 + v * 3] + offset[0], true);
      dv.setFloat32(o + 4, tris[p + 4 + v * 3] + offset[1], true);
      dv.setFloat32(o + 8, tris[p + 5 + v * 3] + offset[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/**
 * @param {object} pose
 * @param {number} headRadiusMM 頭半徑（mm）
 * @param {object} opts { tolerance, segments, baseDiameter }
 * @returns {{blob:Blob, size:object, triangles:number, segments:number, bytes:number}}
 */
export function exportSTL(pose, headRadiusMM, opts = {}) {
  const segments     = opts.segments ?? segmentsFor(headRadiusMM, opts.tolerance ?? 0.05, opts.floor ?? 40);
  const baseDiameter = opts.baseDiameter ?? 0;

  const mat = new THREE.MeshBasicMaterial();
  const geos = buildGeometries(segments);
  const { group, meshes } = buildFigure(geos, mat);
  applyPose(meshes, fk(pose).parts);

  const root = new THREE.Group();
  root.add(group);
  root.scale.setScalar(headRadiusMM);

  // 先只收人偶本體，算出置中與落地的位移並直接套用到頂點
  const fig = collectTriangles(root);
  const offset = [
    -(fig.min[0] + fig.max[0]) / 2,
    -(fig.min[1] + fig.max[1]) / 2,
    -fig.min[2]
  ];
  shift(fig.tris, fig.count, offset);

  const size = {
    x: fig.max[0] - fig.min[0],
    y: fig.max[1] - fig.min[1],
    z: fig.max[2] - fig.min[2]
  };

  // 底座在人偶落地之後才加，位置就是列印平台 z = 0，
  // 人偶最低處也在 z = 0，兩者自然重疊成一體
  let tris = fig.tris, count = fig.count;
  if (baseDiameter > 0) {
    const baseRoot = new THREE.Group();
    baseRoot.add(new THREE.Mesh(makeBaseMM(baseDiameter, 96), mat));
    const b = collectTriangles(baseRoot);
    tris = fig.tris.concat(b.tris);
    count = fig.count + b.count;
    size.x = Math.max(size.x, baseDiameter);
    size.y = Math.max(size.y, baseDiameter);
    size.z = Math.max(size.z, BASE_THICKNESS);
    baseRoot.children[0].geometry.dispose();
  }

  const blob = new Blob([writeBinarySTL(tris, count, [0, 0, 0])], { type: 'model/stl' });

  disposeGeometries(geos);
  mat.dispose();

  return { blob, size, triangles: count, skipped: fig.skipped, segments, bytes: blob.size };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
