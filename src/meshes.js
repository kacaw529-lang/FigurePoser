/**
 * meshes.js — 產生人偶各部位的 three.js 網格
 *
 * 全部以「頭半徑 = 1」建立，實際尺寸由外層 group.scale 決定，
 * 因此調整頭部直徑時不需要重建任何幾何。
 *
 * 每個零件的局部座標系原點都放在它的關節上，肢體沿 −Z 延伸，
 * 與 skeleton.js 的 fk() 回傳的矩陣完全對應。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { P, SEGMENTS } from './skeleton.js';

/** 膠囊：關節在原點，沿 −Z 延伸 len，兩端各一顆半球 */
function capsule(r, len, seg) {
  const g = new THREE.CapsuleGeometry(r, len, Math.max(4, Math.round(seg / 2)), seg);
  g.rotateX(Math.PI / 2);      // three 的膠囊沿 +Y，轉成沿 Z
  g.translate(0, 0, -len / 2); // 使起點球心落在原點
  return g;
}

/**
 * 依品質建立全部幾何
 * @param {number} seg 圓周分段數（預覽 20、匯出 48 左右）
 */
export function buildGeometries(seg = 24) {
  const geos = {
    torso: new RoundedBoxGeometry(P.torsoW, P.torsoD, P.torsoH,
      Math.max(2, Math.round(seg / 8)), P.torsoR),
    head: new THREE.SphereGeometry(P.headR, seg, Math.max(8, Math.round(seg / 2)))
  };
  for (const [id, s] of Object.entries(SEGMENTS)) geos[id] = capsule(s.r, s.len, seg);
  return geos;
}

export function disposeGeometries(geos) {
  if (geos) Object.values(geos).forEach(g => g.dispose && g.dispose());
}

/**
 * 建立人偶群組。回傳 { group, meshes }
 * group 尚未縮放，呼叫端自行設定 scale 與位移。
 */
export function buildFigure(geos, material) {
  const group = new THREE.Group();
  const meshes = {};
  for (const id of Object.keys(geos)) {
    const m = new THREE.Mesh(geos[id], material);
    m.matrixAutoUpdate = false;
    m.castShadow = m.receiveShadow = true;
    meshes[id] = m;
    group.add(m);
  }
  return { group, meshes };
}

const _m = new THREE.Matrix4();

/** 把 fk() 算出的零件姿態寫進網格矩陣 */
export function applyPose(meshes, parts) {
  for (const p of parts) {
    const mesh = meshes[p.id];
    if (!mesh) continue;
    const R = p.R, t = p.t;
    _m.set(
      R[0][0], R[0][1], R[0][2], t[0],
      R[1][0], R[1][1], R[1][2], t[1],
      R[2][0], R[2][1], R[2][2], t[2],
      0, 0, 0, 1
    );
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
  }
}

/** 選配底座：貼在 Z=0 的薄圓盤（單位為 mm，需自行換算成模型單位） */
export function makeBase(diameterModelUnits, thickness, material, seg = 64) {
  const g = new THREE.CylinderGeometry(diameterModelUnits / 2, diameterModelUnits / 2, thickness, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, thickness / 2);
  const m = new THREE.Mesh(g, material);
  m.matrixAutoUpdate = false;
  return m;
}
