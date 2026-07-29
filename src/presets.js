/**
 * presets.js — 八款預設動作
 * 未列出的欄位一律視為 0。角度定義見 skeleton.js
 */
export const PRESETS = {
  '01 舉手抱頭': {
    armPitchL: 160, armOutL: 35, armTwistL: 50, elbowL: 82,
    armPitchR: 160, armOutR: 35, armTwistR: 50, elbowR: 82
  },
  '02 雙手歡呼': {
    armPitchL: 0, armOutL: 90, armTwistL: 90, elbowL: 90,
    armPitchR: 0, armOutR: 90, armTwistR: 90, elbowR: 90
  },
  '03 直立': {
    armOutL: 7, armOutR: 7, hipOutL: 3, hipOutR: 3
  },
  '04 跪坐': {
    hipPitchL: 15, kneeL: 145, hipOutL: 8,
    hipPitchR: 15, kneeR: 145, hipOutR: 8,
    armPitchL: 12, armOutL: 8, elbowL: 20,
    armPitchR: 12, armOutR: 8, elbowR: 20
  },
  // 趴：rootPitch 為正代表整體往前傾，臉朝下。
  // 髖同步跟到 80°，大腿在世界座標維持垂直，跪在地上；
  // 腰只彎 10°，超過就會在背上擠出一塊圓凸。
  '05 蜷曲趴伏': {
    rootPitch: 82, waistPitch: 10, headPitch: 16,
    hipPitchL: 80, kneeL: 152, hipOutL: 11,
    hipPitchR: 80, kneeR: 152, hipOutR: 11,
    armPitchL: -45, armOutL: 13, elbowL: 100,
    armPitchR: -45, armOutR: 13, elbowR: 100
  },
  '06 仰躺': {
    rootPitch: -90, headPitch: 12,
    armOutL: 12, armOutR: 12, hipOutL: 5, hipOutR: 5
  },
  '07 側躺': {
    rootPitch: -90, rootRoll: 62, waistPitch: 10, headPitch: 15,
    hipPitchL: 55, kneeL: 70, hipPitchR: 30, kneeR: 40,
    armPitchL: 45, elbowL: 65, armPitchR: 20, elbowR: 30
  },
  '08 大字型': {
    rootPitch: -90, armOutL: 78, armOutR: 78, hipOutL: 32, hipOutR: 32
  }
};

export const DEFAULT_PRESET = '03 直立';
