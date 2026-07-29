/**
 * main.js — UI 綁定與各模組串接
 */
import { KEYS, LR_KEYS, LIMITS, clonePose, clampPose, STANDING_H, fk, centerOfMass, boundingBox } from './skeleton.js';
import { PRESETS, DEFAULT_PRESET } from './presets.js';
import { Editor2D } from './editor2d.js';
import { Viewer3D } from './viewer3d.js';
import { exportSTL, download } from './stl.js';
import { encodeState, decodeState, shareURL, HEAD_MIN, HEAD_MAX } from './share.js';

/**
 * 版本編號會顯示在標題旁邊。
 * 更新網站後若看不出變化，先確認這裡的號碼有沒有跟著變——
 * GitHub Pages 對 JS 檔會快取十分鐘，多半是瀏覽器還在用舊檔，按 Ctrl+Shift+R 即可。
 */
const VERSION = 'v1.6.0';

const $ = id => document.getElementById(id);
$('ver').textContent = VERSION;

const state = {
  pose: clonePose(PRESETS[DEFAULT_PRESET]),
  mirror: false,
  headDiameter: 6.2,   // mm，預設約等於 30 mm 高的成品
  baseDiameter: 0,
  presetName: DEFAULT_PRESET
};
const headRadius = () => state.headDiameter / 2;

// 網址帶了姿勢就以它為準，否則用預設動作
const fromURL = decodeState(window.location.hash);
if (fromURL) {
  Object.assign(state, fromURL);
  state.presetName = null;
}

// ── 建立元件 ─────────────────────────────────────────────
// 拖曳過的姿勢就不再屬於任何預設動作，取消高亮並改用 custom 檔名
const editor = new Editor2D($('cvFront'), $('cvSide'), state, () => {
  state.presetName = null;
  markPreset(null);
  refresh();
});

// 3D 預覽需要 WebGL。老舊或停用硬體加速的電腦仍應能拖姿勢與匯出 STL，
// 因此這裡失敗只降級，不中斷整個程式。
let viewer = null;
try {
  viewer = new Viewer3D($('view3d'));
} catch (err) {
  console.warn('無法建立 3D 預覽：', err);
  $('view3d').innerHTML =
    '<div class="fallback">這台裝置無法啟用 3D 預覽（WebGL 不可用）<br>' +
    '拖拉編輯與 STL 匯出仍可正常使用</div>';
}

// ── 預設動作按鈕 ─────────────────────────────────────────
const presetRow = $('presetRow');
for (const name of Object.keys(PRESETS)) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = name;
  b.dataset.name = name;
  b.onclick = () => {
    state.pose = clonePose(PRESETS[name]);
    state.presetName = name;
    markPreset(name);
    refresh(true);
  };
  presetRow.appendChild(b);
}
function markPreset(name) {
  [...presetRow.children].forEach(c => c.classList.toggle('on', c.dataset.name === name));
}

// ── 姿態滑桿 ─────────────────────────────────────────────
// 範圍一律取自 skeleton.js 的 LIMITS，不另外寫死
const SLIDERS = [
  ['rootPitch', '全身前傾'],
  ['rootRoll', '全身側傾'],
  ['waistPitch', '腰・前彎'],
  ['waistTwist', '腰・扭轉'],
  ['armTwistL', '左臂扭轉'],
  ['armTwistR', '右臂扭轉']
].map(([k, label]) => {
  const lim = LIMITS[/[LR]$/.test(k) ? k.slice(0, -1) : k];
  return [k, label, lim[0], lim[1]];
});
const slBox = $('sliders');
for (const [key, label, mn, mx] of SLIDERS) {
  const row = document.createElement('div');
  row.className = 'sl';
  row.innerHTML =
    `<span>${label}</span>` +
    `<input type="range" min="${mn}" max="${mx}" step="1" data-k="${key}">` +
    `<b data-v="${key}">0°</b>`;
  slBox.appendChild(row);
  row.querySelector('input').addEventListener('input', e => {
    state.pose[key] = +e.target.value;
    if (state.mirror && key === 'armTwistL') state.pose.armTwistR = state.pose.armTwistL;
    if (state.mirror && key === 'armTwistR') state.pose.armTwistL = state.pose.armTwistR;
    state.presetName = null; markPreset(null);
    refresh();
  });
}
function syncSliders() {
  for (const [key] of SLIDERS) {
    const i = slBox.querySelector(`input[data-k="${key}"]`);
    if (i && document.activeElement !== i) i.value = state.pose[key];
    slBox.querySelector(`b[data-v="${key}"]`).textContent = Math.round(state.pose[key]) + '°';
  }
}

// ── 尺寸與底座 ───────────────────────────────────────────
$('headDia').addEventListener('input', e => {
  state.headDiameter = Math.max(HEAD_MIN, Math.min(HEAD_MAX, +e.target.value));
  $('headDiaVal').textContent = state.headDiameter.toFixed(1) + ' mm';
  viewer?.setBase(state.baseDiameter);
  refresh(true);
});
$('baseDia').addEventListener('input', e => {
  state.baseDiameter = +e.target.value;
  $('baseDiaVal').textContent = state.baseDiameter ? state.baseDiameter + ' mm' : '不加';
  viewer?.setBase(state.baseDiameter);
  refresh();
});

// ── 其他控制 ─────────────────────────────────────────────
$('mirror').addEventListener('change', e => {
  state.mirror = e.target.checked;
  if (state.mirror) LR_KEYS.forEach(k => { state.pose[k + 'R'] = state.pose[k + 'L']; });
  refresh();
});
$('btnReset').onclick = () => {
  state.pose = clonePose(null);
  state.presetName = null; markPreset(null);
  refresh(true);
};

// ── 分享連結 ─────────────────────────────────────────────
// 網址每次拖曳都改寫的話，瀏覽器會限流（Safari 約 30 秒 100 次），
// 所以畫面上的連結即時更新，真正寫回網址列則延遲到停手之後。
let hashTimer = null;
let lastHash = '';
function scheduleHashWrite() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = '#' + encodeState(state);
    if (h === lastHash) return;
    lastHash = h;
    try { window.history.replaceState(null, '', h); } catch (_) { /* file:// 下會擋，忽略 */ }
  }, 250);
}

window.addEventListener('hashchange', () => {
  if (window.location.hash === lastHash) return;     // 自己寫回去的，不用理
  const s = decodeState(window.location.hash);
  if (!s) return;
  Object.assign(state, s);
  state.presetName = null;
  markPreset(null);
  $('headDia').value = state.headDiameter;
  $('baseDia').value = state.baseDiameter;
  $('headDiaVal').textContent = state.headDiameter.toFixed(1) + ' mm';
  $('baseDiaVal').textContent = state.baseDiameter ? state.baseDiameter + ' mm' : '不加';
  viewer?.setBase(state.baseDiameter);
  refresh(true);
});

$('btnShare').onclick = async () => {
  const b = $('btnShare');
  const url = $('shareUrl');
  try { await navigator.clipboard.writeText(url.value); }
  catch (_) { url.select(); document.execCommand('copy'); }
  flash(b, '已複製 ✓', '複製連結');
};

// ── 姿勢代碼 ─────────────────────────────────────────────
$('btnCopy').onclick = async () => {
  const b = $('btnCopy');
  try { await navigator.clipboard.writeText($('code').value); }
  catch (_) { $('code').select(); document.execCommand('copy'); }
  flash(b, '已複製 ✓', '複製');
};
$('btnLoad').onclick = () => {
  const b = $('btnLoad');
  try {
    const j = JSON.parse($('code').value);
    KEYS.forEach(k => { if (typeof j[k] === 'number') state.pose[k] = j[k]; });
    state.presetName = null; markPreset(null);
    refresh(true);
    flash(b, '已讀入 ✓', '讀入');
  } catch (_) {
    flash(b, '格式錯誤 ✗', '讀入');
  }
};
function flash(btn, msg, back) {
  btn.textContent = msg;
  setTimeout(() => btn.textContent = back, 1500);
}

// ── 匯出 STL ─────────────────────────────────────────────
$('btnExport').onclick = () => {
  const btn = $('btnExport');
  btn.disabled = true;
  btn.textContent = '產生中…';
  // 讓瀏覽器先把「產生中」畫出來再開始運算
  setTimeout(() => {
    try {
      const q = $('quality').selectedOptions[0];
      const r = exportSTL(state.pose, headRadius(), {
        tolerance: +q.value,
        floor: +q.dataset.floor,
        baseDiameter: state.baseDiameter
      });
      const tag = (state.presetName || 'custom').replace(/[^\w\u4e00-\u9fa5]+/g, '');
      const name = `figure-${tag}-${Math.round(r.size.z)}mm.stl`;
      download(r.blob, name);
      $('exportInfo').textContent =
        `已輸出 ${name}　外框 ${fmt(r.size.x)} × ${fmt(r.size.y)} × ${fmt(r.size.z)} mm　` +
        `圓周 ${r.segments} 段　三角面 ${r.triangles.toLocaleString()}　` +
        `檔案 ${r.bytes > 1048576 ? (r.bytes / 1048576).toFixed(2) + ' MB' : Math.round(r.bytes / 1024) + ' KB'}`;
    } catch (err) {
      $('exportInfo').textContent = '匯出失敗：' + err.message;
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.textContent = '匯出 STL';
    }
  }, 30);
};

const fmt = v => v.toFixed(1);

// ── 主更新 ───────────────────────────────────────────────
function refresh(reframe = false) {
  const info = editor.draw();
  const hr = headRadius();
  const com = centerOfMass(fk(state.pose).joints);
  const bb = boundingBox(state.pose);

  if (viewer) {
    viewer.update(state.pose, hr, bb, com, info.stable);
    if (reframe) viewer.frame(hr);
  }

  clampPose(state.pose);
  $('code').value = JSON.stringify(state.pose);
  $('shareUrl').value = shareURL(state, window.location);
  scheduleHashWrite();
  syncSliders();

  const sx = Math.max(bb.size[0] * hr, state.baseDiameter);
  const sy = Math.max(bb.size[1] * hr, state.baseDiameter);
  $('sizeStand').textContent = fmt(STANDING_H * hr) + ' mm';
  $('sizeBox').textContent = `${fmt(sx)} × ${fmt(sy)} × ${fmt(bb.size[2] * hr)} mm`;

  const st = $('stability');
  st.className = 'stat ' + (info.stable ? 'ok' : 'bad');
  st.textContent = info.stable
    ? '重心穩定，站得住'
    : '重心偏出支撐範圍，列印後可能會倒（可加底座）';
}

// ── 版面 ─────────────────────────────────────────────────
function layout() {
  editor.resize();
  viewer?.resize();
  refresh();
}
window.addEventListener('resize', layout);

$('headDiaVal').textContent = state.headDiameter.toFixed(1) + ' mm';
$('headDia').value = state.headDiameter;
markPreset(state.presetName);
layout();
viewer?.frame(headRadius());

window.__poserReady = true;   // 供 index.html 的載入失敗偵測使用
