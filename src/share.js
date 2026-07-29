/**
 * share.js — 把姿勢與尺寸編進網址，讓一條連結就能還原整個畫面
 *
 * 格式：#p=<20 個角度，逗號分隔>&h=<頭部直徑 mm>&b=<底座直徑 mm，0 時省略>
 * 角度依 skeleton.js 的 KEYS 順序排列，全部四捨五入成整數。
 *
 * 刻意不用 JSON + Base64：這樣網址是人看得懂的，出問題時能直接看出哪個值不對，
 * 長度也比編碼過的短。
 */
import { KEYS, clamp, clampPose, emptyPose } from './skeleton.js';

export const HEAD_MIN = 4;    // 再小下去頸部只剩約四條擠出線寬，容易斷
export const HEAD_MAX = 40;
export const BASE_MAX = 60;

/** @returns {string} 不含開頭 '#' 的查詢字串 */
export function encodeState(state) {
  const p = KEYS.map(k => Math.round(state.pose[k] || 0)).join(',');
  const parts = [`p=${p}`, `h=${+(+state.headDiameter).toFixed(2)}`];
  if (state.baseDiameter > 0) parts.push(`b=${Math.round(state.baseDiameter)}`);
  return parts.join('&');
}

/**
 * @param {string} hash 可含或不含開頭 '#'
 * @returns {{pose:object, headDiameter:number, baseDiameter:number}|null} 無法解析時回傳 null
 */
export function decodeState(hash) {
  if (!hash) return null;
  let params;
  try {
    params = new URLSearchParams(String(hash).replace(/^#/, ''));
  } catch (_) {
    return null;
  }
  const raw = params.get('p');
  if (!raw) return null;

  const nums = raw.split(',').map(Number);
  if (nums.length !== KEYS.length || nums.some(n => !Number.isFinite(n))) return null;

  const pose = emptyPose();
  KEYS.forEach((k, i) => { pose[k] = nums[i]; });
  clampPose(pose);

  const h = Number(params.get('h'));
  const b = Number(params.get('b'));
  return {
    pose,
    headDiameter: Number.isFinite(h) && h > 0 ? clamp(h, HEAD_MIN, HEAD_MAX) : 6.2,
    baseDiameter: Number.isFinite(b) && b > 0 ? clamp(b, 0, BASE_MAX) : 0
  };
}

/** 組出可直接傳給別人的完整網址 */
export function shareURL(state, location) {
  return location.origin + location.pathname + '#' + encodeState(state);
}
