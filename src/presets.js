/**
 * presets.js — 八款預設動作
 * 未列出的欄位一律視為 0。角度定義見 skeleton.js
 */
export const PRESETS = {
  // 手掌要真的碰到頭（距頭心 0.86，頭半徑 1，略為融接），手肘朝上前方張開。
  // 舊值的手掌浮在頭上方 1.46 處、手肘還交叉到中線，看起來像「雙手抱在頭頂上方」。
  '01 舉手抱頭': {
    armPitchL: 155, armOutL: 0, armTwistL: -30, elbowL: 105,
    armPitchR: 155, armOutR: 0, armTwistR: -30, elbowR: 105
  },
  '02 雙手歡呼': {
    armPitchL: 0, armOutL: 90, armTwistL: 90, elbowL: 90,
    armPitchR: 0, armOutR: 90, armTwistR: 90, elbowR: 90
  },
  '03 直立': {
    armOutL: 7, armOutR: 7, hipOutL: 3, hipOutR: 3
  },
  // 正座：小腿要平貼地面，條件是「膝彎 = 髖屈 + 90」。
  // 髖 60 / 膝 150 剛好滿足，膝與腳同時著地，臀部落在腳跟上方。
  // 外展設為 0，兩隻腳跟才會併攏到臀部正下方，把軀幹底面遮住。
  '04 跪坐': {
    hipPitchL: 60, kneeL: 150, hipOutL: 0,
    hipPitchR: 60, kneeR: 150, hipOutR: 0,
    armPitchL: 10, armOutL: 8, elbowL: 25,
    armPitchR: 10, armOutR: 8, elbowR: 25
  },
  // 趴：rootPitch 為正代表整體往前傾，臉朝下。
  // 這組數值由實際拖曳調出：頭低到極限(30°)貼地、手肘全折收在身側、
  // 雙腿外展 24° 攤平。總高只有 8.6 mm（30 mm 成品），接觸面大、最好印。
  '05 趴伏': {
    rootPitch: 85, waistPitch: -5, headPitch: 30,
    armPitchL: 13, armOutL: 13, elbowL: 150,
    hipPitchL: 7, hipOutL: 24, kneeL: 150,
    armPitchR: 13, armOutR: 13, elbowR: 150,
    hipPitchR: 7, hipOutR: 24, kneeR: 150
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
