/**
 * viewer3d.js — three.js 即時預覽
 *
 * 場景層級：
 *   placeGroup（落地位移）→ scaleGroup（頭部直徑縮放）→ 各零件網格
 * 拖曳姿勢時只更新零件矩陣，不重建幾何，因此可以跟拖拉同步更新。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildGeometries, disposeGeometries, buildFigure, applyPose, makeBaseMM } from './meshes.js';
import { fk, boundingBox, STANDING_H } from './skeleton.js';

export class Viewer3D {
  constructor(container) {
    this.el = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);
    this.camera.up.set(0, 0, 1);                    // 本專案是 Z 軸向上
    this.camera.position.set(-95, -150, 85);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = false;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 900;

    // 光線
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8bda9, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-70, -110, 150);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const d = 90;
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 500 });
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(90, 60, 40);
    this.scene.add(fill);

    // 地板與格線
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.ShadowMaterial({ opacity: 0.16 })
    );
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.grid = new THREE.GridHelper(400, 40, 0xcfc4b2, 0xe4dccd);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    // 人偶
    this.material = new THREE.MeshStandardMaterial({
      color: 0xf7f4ee, roughness: 0.82, metalness: 0.0, flatShading: false
    });
    this.placeGroup = new THREE.Group();
    this.scaleGroup = new THREE.Group();
    this.placeGroup.add(this.scaleGroup);
    this.scene.add(this.placeGroup);

    this.geos = null;
    this.meshes = null;
    this.figureGroup = null;
    this.base = null;
    this.setQuality(32);

    // 重心標記
    const cm = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x4f9d69, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    cm.position.z = 0.25;
    this.comMark = cm;
    this.scene.add(cm);

    this._raf = null;
    this._tick = this._tick.bind(this);
    this._tick();
  }

  setQuality(seg) {
    const old = this.geos;
    this.geos = buildGeometries(seg);
    if (this.figureGroup) this.scaleGroup.remove(this.figureGroup);
    const { group, meshes } = buildFigure(this.geos, this.material);
    this.figureGroup = group;
    this.meshes = meshes;
    this.scaleGroup.add(group);
    disposeGeometries(old);
  }

  /**
   * 底座直徑（mm），0 表示不加。
   * 底座直接掛在場景上（場景單位就是 mm），不放進會縮放或位移的群組，
   * 否則它會跟著人偶的置中位移跑到腰部高度，而且移除時父節點對不上就刪不掉。
   */
  setBase(diameterMM) {
    if (this.base) {
      this.base.parent.remove(this.base);
      this.base.geometry.dispose();
      this.base = null;
    }
    if (diameterMM > 0) {
      this.base = new THREE.Mesh(makeBaseMM(diameterMM, 64), this.material);
      this.base.castShadow = this.base.receiveShadow = true;
      this.scene.add(this.base);
    }
  }

  /**
   * 更新姿勢與尺寸
   * @param {object} pose
   * @param {number} headRadiusMM 頭半徑（mm）
   * @returns {{size:THREE.Vector3, min:THREE.Vector3}} 實際外框
   */
  /**
   * 更新姿勢與尺寸
   * @param {object} bb  skeleton.boundingBox() 的結果（單位為頭半徑）
   */
  update(pose, headRadiusMM, bb, com, stable) {
    applyPose(this.meshes, fk(pose).parts);
    this.scaleGroup.scale.setScalar(headRadiusMM);

    const min = bb.min.map(v => v * headRadiusMM);
    const max = bb.max.map(v => v * headRadiusMM);
    this.placeGroup.position.set(-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]);
    this.placeGroup.updateMatrixWorld(true);

    this.comMark.position.set(
      com[0] * headRadiusMM + this.placeGroup.position.x,
      com[1] * headRadiusMM + this.placeGroup.position.y,
      0.25
    );
    this.comMark.material.color.setHex(stable ? 0x4f9d69 : 0xcf5b4a);
    this.controls.target.set(0, 0, Math.max((max[2] - min[2]) / 2, 5));
  }

  /** 依人偶大小把鏡頭拉到合適距離 */
  frame(headRadiusMM) {
    const h = STANDING_H * headRadiusMM;
    const dist = h * 2.4 + 30;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.grid.scale.setScalar(Math.max(h / 60, 0.25));
    this.controls.update();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
