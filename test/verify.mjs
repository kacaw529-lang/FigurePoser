import { JSDOM } from 'jsdom'
import fs from 'node:fs'

// 執行方式：npm i --no-save three jsdom && node test/verify.mjs
import { Blob } from 'node:buffer'
process.chdir(new URL('..', import.meta.url).pathname)
globalThis.Blob = globalThis.Blob || Blob

const SK = await import('../src/skeleton.js')
const { PRESETS } = await import('../src/presets.js')
const { exportSTL, segmentsFor } = await import('../src/stl.js')
const SH = await import('../src/share.js')
const PR = await import('../src/printability.js')

let pass = 0, fail = 0
const check = (name, ok, extra='') => { ok ? pass++ : fail++; console.log(`${ok?'✓':'✗'} ${name}${extra?'  '+extra:''}`) }

console.log('【幾何約束】')
const P = SK.P
check('肩球頂不高於軀幹頂面', P.shoulderZ + P.armR <= P.torsoH, `餘裕 ${(P.torsoH-P.shoulderZ-P.armR).toFixed(3)}`)
check('頭球底部埋入軀幹',      P.headPivotZ + P.headDist - P.headR < P.torsoH, `埋入 ${(P.torsoH-(P.headPivotZ+P.headDist-P.headR)).toFixed(3)}`)
check('髖球未穿出軀幹底面',    P.hipZ - P.legR >= 0, `餘裕 ${(P.hipZ-P.legR).toFixed(3)}`)
check('髖球未穿出軀幹側面',    P.hipX + P.legR <= P.torsoW/2, `餘裕 ${(P.torsoW/2-P.hipX-P.legR).toFixed(3)}`)
{
  // 頭部傾到錐角極限時，仍必須與軀幹保有足夠粗的交界（無脖子設計，靠重疊相連）
  let worst = Infinity, at = '';
  for (const [p, r] of [[1,0],[-1,0],[0,1],[0,-1],[0.707,0.707],[-0.707,0.707]]) {
    const pose = SK.clonePose(null);
    pose.headPitch = SK.HEAD_TILT_MAX * p;
    pose.headRoll  = SK.HEAD_TILT_MAX * r;
    const { joints: J } = SK.fk(pose);
    const sd = SK.torsoSDF(SK.ap(SK.tp(J.Mwaist), J.head));
    const neck = 2 * Math.sqrt(Math.max(0, P.headR ** 2 - sd ** 2)) * 3.1;
    if (sd >= P.headR) { worst = 0; at = `傾角 ${SK.HEAD_TILT_MAX}° 方向(${p},${r}) 已脫離`; break; }
    if (neck < worst) { worst = neck; at = `方向(${p},${r})`; }
  }
  check(`頭傾到 ±${SK.HEAD_TILT_MAX}° 仍與軀幹相連`, worst > 2.5,
        `最細交界 ${worst.toFixed(2)} mm（30 mm 成品）@ ${at}`);
}

console.log('\n【前後方向】')
{
  const facing = pose => { const { joints: J } = SK.fk(pose); return [J.Mwaist[0][1], J.Mwaist[1][1], J.Mwaist[2][1]]; }
  const bend = pose => SK.fk(pose).joints.headPivot[1];   // 軀幹頂端的前後位置

  const prone = SK.clonePose(null); prone.rootPitch = 90;
  const supine = SK.clonePose(null); supine.rootPitch = -90;
  check('全身前傾 +90 = 趴著（臉朝下）', facing(prone)[2] < -0.99, `臉 z=${facing(prone)[2].toFixed(2)}`)
  check('全身前傾 −90 = 仰躺（臉朝上）', facing(supine)[2] > 0.99, `臉 z=${facing(supine)[2].toFixed(2)}`)

  const bow = SK.clonePose(null); bow.waistPitch = 20;
  check('腰・前彎為正時軀幹確實往前', bend(bow) > 0.5, `軀幹頂 y=${bend(bow).toFixed(2)}`)

  const head = SK.clonePose(null); head.headPitch = 25;
  check('頭・低頭為正時頭確實往前低', SK.fk(head).joints.head[1] > 0.3, `頭 y=${SK.fk(head).joints.head[1].toFixed(2)}`)

  const want = { '05 趴伏': 'down', '06 仰躺': 'up', '08 大字型': 'up' };
  for (const [name, dir] of Object.entries(want)) {
    const f = facing(SK.clonePose(PRESETS[name]))[2];
    check(`${name} 臉朝${dir === 'down' ? '下' : '上'}`,
          dir === 'down' ? f < -0.5 : f > 0.5, `臉 z=${f.toFixed(2)}`)
  }
}

console.log('\n【身體比例】')
{
  const H = SK.STANDING_H;
  // 成人實測（Drillis & Contini）佔身高的比例
  const ADULT = { upArm: 0.186, loArm: 0.146, upLeg: 0.245, loLeg: 0.246, torsoW: 0.259 };
  // 前臂／上臂的比值不受大頭 Q 版風格影響，可直接與成人對照
  check('前臂／上臂符合成人比例',
        Math.abs((P.loArm / P.upArm) / (ADULT.loArm / ADULT.upArm) - 1) < 0.06,
        `${(P.loArm / P.upArm).toFixed(3)} vs 成人 ${(ADULT.loArm / ADULT.upArm).toFixed(3)}`);
  check('上肢全長接近成人比例',
        Math.abs(((P.upArm + P.loArm) / H) / (ADULT.upArm + ADULT.loArm) - 1) < 0.08,
        `${((P.upArm + P.loArm) / H).toFixed(3)} vs 成人 ${(ADULT.upArm + ADULT.loArm).toFixed(3)}`);
  check('下肢全長接近成人比例',
        Math.abs(((P.upLeg + P.loLeg) / H) / (ADULT.upLeg + ADULT.loLeg) - 1) < 0.08,
        `${((P.upLeg + P.loLeg) / H).toFixed(3)} vs 成人 ${(ADULT.upLeg + ADULT.loLeg).toFixed(3)}`);
  // 頭與軀幹刻意放大，是 Q 版風格的來源，這裡只確認它確實仍是 Q 版
  check('維持 Q 版頭身比', H / 2 > 4.3 && H / 2 < 5.6, `${(H / 2).toFixed(2)} 個頭高（成人約 7.5）`);
}

console.log('\n【接縫平滑度】')
check('關節兩側直徑相同（foreScale = 1）', P.foreScale === 1,
      `上臂 ${P.armR} / 前臂 ${(P.armR*P.foreScale).toFixed(3)}`)
check('軀幹圓角 ≥ 手臂半徑（肩部收得進去）', P.torsoR >= P.armR, `圓角 ${P.torsoR} vs 手臂半徑 ${P.armR}`)
{
  // 關節球是否確實埋在軀幹表面內
  const probe = (label, p) => SK.torsoSDF(p)
  const s = [
    ['肩球頂', [P.shoulderX, 0, P.shoulderZ + P.armR]],
    ['肩球後', [P.shoulderX, -P.armR, P.shoulderZ]],
    ['髖球底', [P.hipX, 0, P.hipZ - P.legR]],
    ['髖球後', [P.hipX, -P.legR, P.hipZ]],
    ['髖球外', [P.hipX + P.legR, 0, P.hipZ]]
  ]
  for (const [label, p] of s) check(`${label}未凸出軀幹`, probe(label, p) <= 0.001, `SDF ${probe(label,p).toFixed(4)}`)
}

console.log('\n【髖球是否始終埋在軀幹內】')
{
  // 髖球位置掛在軀幹座標系，所以不論腰怎麼轉都應該埋著。
  // 這正是使用者回報「大腿上端跑出身體」的直接判準。
  const out = pose => {
    const { joints: J } = SK.fk(pose);
    let mx = -Infinity;
    for (const h of [J.hipL, J.hipR])
      mx = Math.max(mx, SK.torsoSDF(SK.ap(SK.tp(J.Mwaist), h)) + P.legR);
    return mx;
  };
  const [wpMin, wpMax] = SK.LIMITS.waistPitch;
  const [wtMin, wtMax] = SK.LIMITS.waistTwist;
  let worst = -Infinity, at = '';
  for (let w = wpMin; w <= wpMax; w += 5)
    for (let tw = wtMin; tw <= wtMax; tw += 5) {
      const v = out(SK.clonePose({ waistPitch: w, waistTwist: tw }));
      if (v > worst) { worst = v; at = `腰前彎 ${w}° 扭轉 ${tw}°`; }
    }
  check('腰部全範圍掃描，髖球都沒露出', worst <= 0, `最差 ${worst.toFixed(3)} @ ${at}`);

  // 若把錨點錯掛回骨盆座標，這個檢查必須抓得到，否則等於沒測
  const naive = pose => {
    const { joints: J } = SK.fk(pose);
    const hipRoot = SK.ap(J.Mroot, [-P.hipX, 0, P.hipZ]);
    return SK.torsoSDF(SK.ap(SK.tp(J.Mwaist), hipRoot)) + P.legR;
  };
  check('錨點掛骨盆座標時確實會露出', naive(SK.clonePose({ waistPitch: 60 })) > 0.1, '證明這個檢查有效');

  for (const [name, pre] of Object.entries(PRESETS))
    check(`${name.padEnd(10)} 髖球埋在軀幹內`, out(SK.clonePose(pre)) <= 0);
}

console.log('\n【軀幹底面是否懸空】')
{
  // 軀幹底部殘留的水平平面若朝正下方又沒被腿遮住，在切片軟體裡會變成一塊懸空的平板，
  // 使用者會誤以為是沒取消掉的底座。跪坐就是最容易踩到的姿勢。
  const segDist = (p, a, b) => {
    const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const ap = [p[0]-a[0], p[1]-a[1], p[2]-a[2]];
    const t = Math.max(0, Math.min(1, (ap[0]*ab[0]+ap[1]*ab[1]+ap[2]*ab[2]) / (ab[0]**2+ab[1]**2+ab[2]**2)));
    return Math.hypot(ap[0]-ab[0]*t, ap[1]-ab[1]*t, ap[2]-ab[2]*t);
  };
  const exposedMM2 = (pose, radius) => {
    const rr = radius ?? P.torsoR;
    const { joints: J } = SK.fk(pose);
    if (J.Mwaist[2][2] < 0.5) return 0;               // 軀幹沒站直，底面就不是朝下，不算
    const fx = P.torsoW/2 - rr, fy = P.torsoD/2 - rr;
    if (fy <= 0) return 0;                             // 圓角吃滿，根本沒有平面
    const caps = [
      [J.hipL, J.kneeL, P.legR], [J.kneeL, J.footL, P.legR*P.foreScale],
      [J.hipR, J.kneeR, P.legR], [J.kneeR, J.footR, P.legR*P.foreScale],
      [J.shoulderL, J.elbowL, P.armR], [J.elbowL, J.handL, P.armR*P.foreScale],
      [J.shoulderR, J.elbowR, P.armR], [J.elbowR, J.handR, P.armR*P.foreScale]
    ];
    let hit = 0, tot = 0;
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 20; j++) {
      const p = SK.ap(J.Mwaist, [-fx + 2*fx*i/60, -fy + 2*fy*j/20, 0]);
      tot++;
      if (caps.some(([a, b, r]) => segDist(p, a, b) <= r)) hit++;
    }
    return (1 - hit/tot) * (2*fx*3.1) * (2*fy*3.1);
  };
  // 門檻 0.25 mm²：以底面長 3.38 mm 換算，等於寬度不到 0.08 mm 的細條，
  // 遠低於 0.4 mm 噴頭能表現的最小特徵，實體上不會存在
  for (const [name, pre] of Object.entries(PRESETS))
    check(`${name.padEnd(10)} 底面無懸空平板`, exposedMM2(SK.clonePose(pre)) < 0.25,
          `${exposedMM2(SK.clonePose(pre)).toFixed(3)} mm²`);

  // 用舊圓角重現使用者回報的那塊平板，確認這個偵測真的有效
  const old04 = SK.clonePose({ hipPitchL: 60, kneeL: 150, hipOutL: 10,
    hipPitchR: 60, kneeR: 150, hipOutR: 10, armPitchL: 10, armOutL: 8, elbowL: 25,
    armPitchR: 10, armOutR: 8, elbowR: 25 });
  check('舊圓角 0.60 時確實偵測得到', exposedMM2(old04, 0.60) > 1.0,
        `${exposedMM2(old04, 0.60).toFixed(3)} mm²，證明檢查有效`);
  check('軀幹底部平面已縮到極小', (P.torsoW - 2*P.torsoR) * (P.torsoD - 2*P.torsoR) * 3.1 * 3.1 < 1.2,
        `${((P.torsoW-2*P.torsoR)*3.1).toFixed(2)} × ${((P.torsoD-2*P.torsoR)*3.1).toFixed(2)} mm`);
}

console.log('\n【預設動作是否名實相符】')
{
  const ground = pose => SK.boundingBox(pose).min[2];
  const stable = pose => {
    const { joints: J } = SK.fk(pose), pts = SK.extremes(J);
    const gz = Math.min(...pts.map(p => p[2])) - P.legR * 0.9;
    const com = SK.centerOfMass(J);
    const low = pts.filter(p => p[2] < gz + 1.1);
    if (!low.length) return false;
    const xs = low.map(p => p[0]), ys = low.map(p => p[1]), pad = 0.38;
    return com[0] > Math.min(...xs) - pad && com[0] < Math.max(...xs) + pad &&
           com[1] > Math.min(...ys) - pad && com[1] < Math.max(...ys) + pad;
  };
  for (const [name, pre] of Object.entries(PRESETS))
    check(`${name.padEnd(10)} 重心穩定`, stable(SK.clonePose(pre)));

  // 01：手掌要真的碰到頭，而且不越過中線
  {
    const { joints: J } = SK.fk(SK.clonePose(PRESETS['01 舉手抱頭']));
    const headC = J.head;
    const d = Math.hypot(J.handR[0]-headC[0], J.handR[1]-headC[1], J.handR[2]-headC[2]);
    check('01 手掌貼合頭部', d < P.headR + P.armR * 0.5, `手到頭心 ${d.toFixed(2)}，頭半徑 ${P.headR}`);
    check('01 雙手未交叉', J.handR[0] > -0.35 && J.handL[0] < 0.35,
          `右手 x=${J.handR[0].toFixed(2)} 左手 x=${J.handL[0].toFixed(2)}`);
  }

  // 04：正座的小腿要平貼地面 —— 膝與腳同時著地
  {
    const pose = SK.clonePose(PRESETS['04 跪坐']);
    const { joints: J } = SK.fk(pose), g = ground(pose);
    const knee = J.kneeL[2] - P.legR - g, foot = J.footL[2] - P.legR - g;
    check('04 小腿平貼地面', knee < 0.05 && foot < 0.05,
          `膝離地 ${(knee*3.1).toFixed(2)} mm、腳離地 ${(foot*3.1).toFixed(2)} mm`);
    check('04 軀幹直立', Math.abs(pose.rootPitch) < 10 && Math.abs(pose.waistPitch) < 10);
  }

  // 05：趴伏要壓低，臀部不能翹得比頭高太多
  {
    const pose = SK.clonePose(PRESETS['05 趴伏']);
    const { joints: J } = SK.fk(pose), g = ground(pose);
    const hip = (J.pelvis[2] - g) * 3.1, h = SK.boundingBox(pose).size[2] * 3.1;
    check('05 姿態夠低伏', h < 13 && hip < 6, `總高 ${h.toFixed(1)} mm、臀高 ${hip.toFixed(1)} mm`);
  }
}

console.log('\n【反解往返】')
{
  let bad=0
  for(let i=0;i<5000;i++){
    const Mp=SK.rotM(Math.random()*200-100,Math.random()*200-100,Math.random()*360-180)
    const sx=Math.random()<.5?-1:1, pitch=Math.random()*340-170, out=Math.random()*110-15
    const dir=SK.ap(SK.mul(Mp,SK.rotM(pitch,-sx*out,0)),[0,0,-1])
    const r=SK.solve2(Mp,dir,sx)
    const d2=SK.ap(SK.mul(Mp,SK.rotM(r.pitch,-sx*r.out,0)),[0,0,-1])
    if(Math.hypot(dir[0]-d2[0],dir[1]-d2[1],dir[2]-d2[2])>1e-9) bad++
  }
  check('肩／髖 2 自由度反解 5000 次', bad===0, `失敗 ${bad}`)
  let bad2=0
  for(let i=0;i<5000;i++){
    const Mup=SK.rotM(Math.random()*300-150,Math.random()*160-80,Math.random()*360-180)
    const bend=Math.random()*150
    const dir=SK.ap(SK.mul(Mup,SK.Rx(bend*Math.PI/180)),[0,0,-1])
    if(Math.abs(SK.clamp(SK.solve1(Mup,dir),0,150)-bend)>1e-9) bad2++
  }
  check('肘／膝 1 自由度反解 5000 次', bad2===0, `失敗 ${bad2}`)
  let over=0
  for(let i=0;i<3000;i++){
    const d=SK.norm([Math.random()*2-1,Math.random()*2-1,Math.random()*2-1])
    const r=SK.solveHead([[1,0,0],[0,1,0],[0,0,1]],d)
    const pose=SK.clonePose(null); Object.assign(pose,r)
    const J=SK.fk(pose).joints
    const dir=SK.norm(SK.sub(J.head,J.headPivot))
    if(SK.deg(Math.acos(SK.clamp(dir[2],-1,1))) > SK.HEAD_TILT_MAX+1e-6) over++
  }
  check('頭部傾角受限制', over===0, `超出 ${over}`)
}

console.log('\n【肩關節可及方向】')
{
  // 手臂方向以「離正下方的仰角 θ」「方位角 φ」表示，φ=0 前、90 側、180 後
  const swing = (pose, side) => {
    const { joints: J } = SK.fk(pose)
    const v = SK.ap(SK.tp(J.Mwaist), SK.norm(SK.sub(J['elbow' + side], J['shoulder' + side])))
    const theta = Math.acos(SK.clamp(-v[2], -1, 1)) * 180 / Math.PI
    const az = Math.abs(Math.atan2(v[0], v[1]) * 180 / Math.PI)
    const max = az <= 90 ? 180 : 180 - (180 - SK.SHOULDER_EXTENSION_MAX) * (az - 90) / 90
    return { theta, az, max, ok: theta <= max + 0.6 }
  }
  // 使用者實際回報的那組不合理姿勢
  const bad = SK.KEYS.reduce((o, k) => (o[k] = 0, o), {})
  bad.armPitchL = -60; bad.armOutL = 179
  const before = swing(bad, 'L')
  check('未修正時確實抓得到違規', !before.ok, `仰角 ${before.theta.toFixed(0)}° 方位 ${before.az.toFixed(0)}° 上限 ${before.max.toFixed(0)}°`)
  const after = swing(SK.clampPose(bad), 'L')
  check('clampPose 修回可及範圍內', after.ok, `修正後 仰角 ${after.theta.toFixed(0)}° 上限 ${after.max.toFixed(0)}°`)

  for (const [n, pre] of Object.entries(PRESETS))
    check(`${n.padEnd(10)} 手臂方向合乎人體`, ['L','R'].every(s => swing(SK.clonePose(pre), s).ok))

  // 任意輸入都必須被修回合法
  let bad2 = 0
  for (let i = 0; i < 20000; i++) {
    const p = SK.KEYS.reduce((o, k) => (o[k] = 0, o), {})
    p.armPitchL = Math.random()*360-180; p.armOutL = Math.random()*360-180
    p.armPitchR = Math.random()*360-180; p.armOutR = Math.random()*360-180
    SK.clampPose(p)
    if (!swing(p,'L').ok || !swing(p,'R').ok) bad2++
  }
  check('任意角度經 clampPose 後皆合法', bad2 === 0, `20000 組，違規 ${bad2}`)
}

console.log('\n【內收受身體阻擋】')
{
  // 肩、髖的關節點都在軀幹內部，純正面平面往內一點就會壓進身體；
  // 但同時往前（或往後）擺開時，抱胸、盤腿這類動作應該仍然做得到
  const adduct = (which, out, pitch) => {
    const p = SK.KEYS.reduce((o, k) => (o[k] = 0, o), {})
    p[which + 'OutL'] = out; p[which + 'PitchL'] = pitch
    SK.clampPose(p)
    return Math.round(p[which + 'OutL'])
  }
  check('手臂純正面內收 40° 被擋下', adduct('arm', -40, 0) === 0, `→ ${adduct('arm', -40, 0)}`)
  check('手臂前擺 30° 時可內收 40°', adduct('arm', -40, 30) === -40, `→ ${adduct('arm', -40, 30)}`)
  check('腿純正面內收 30° 被擋下', adduct('hip', -30, 0) === 0, `→ ${adduct('hip', -30, 0)}`)
  check('腿前擺 60° 時可內收 30°', adduct('hip', -30, 60) === -30, `→ ${adduct('hip', -30, 60)}`)

  // 兩條大腿不該被內收擠成幾乎重合
  const thighOverlap = pose => {
    const { joints: J } = SK.fk(pose)
    let m = Infinity
    for (let i = 0; i <= 20; i++) {
      const a = [0,1,2].map(k => J.hipL[k] + (J.kneeL[k] - J.hipL[k]) * i / 20)
      for (let j = 0; j <= 20; j++) {
        const b = [0,1,2].map(k => J.hipR[k] + (J.kneeR[k] - J.hipR[k]) * j / 20)
        m = Math.min(m, Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]))
      }
    }
    return (2 * P.legR - m) / (2 * P.legR)
  }
  check('雙腿併攏時重疊維持在基準值', thighOverlap(SK.clonePose(null)) < 0.25,
        `${(thighOverlap(SK.clonePose(null)) * 100).toFixed(0)}%`)
  check('刻意內收後雙腿不會幾乎重合',
        thighOverlap(SK.clonePose({ hipOutL: -30, hipOutR: -30 })) < 0.3,
        `${(thighOverlap(SK.clonePose({ hipOutL: -30, hipOutR: -30 })) * 100).toFixed(0)}%`)

  // 預設一個都不能被這些新規則改到
  let touched = 0
  for (const pre of Object.values(PRESETS)) {
    const a = SK.KEYS.reduce((o, k) => (o[k] = pre[k] ?? 0, o), {})
    const b = SK.clonePose(pre)
    if (SK.KEYS.some(k => Math.abs(a[k] - b[k]) > 0.5)) touched++
  }
  check('八款預設未被新規則改動', touched === 0, `${touched} 款被改動`)
}

console.log('\n【不能把關節拖進身體裡】')
{
  const depth = (pose, key) => SK.bodyPenetration(SK.fk(pose).joints, key)
  // 內收受限之後仍有辦法把關節埋進身體：手臂垂著、外旋 90° 再把前臂往內折
  const bad = SK.clonePose({ armTwistR: -90, elbowR: 90 })
  const rWrist = P.armR * P.foreScale
  check('偵測得到手掌被身體吞掉', depth(bad, 'handR') > rWrist,
        `陷入 ${depth(bad,'handR').toFixed(2)}，前臂半徑 ${rWrist.toFixed(2)}`)
  // 正常姿勢不能誤判
  let worst = 0, who = ''
  for (const [n, pre] of Object.entries(PRESETS)) {
    const pose = SK.clonePose(pre)
    for (const [k, r] of [['handL', P.armR*P.foreScale], ['elbowL', P.armR],
                          ['handR', P.armR*P.foreScale], ['elbowR', P.armR],
                          ['footL', P.legR*P.foreScale], ['kneeL', P.legR],
                          ['footR', P.legR*P.foreScale], ['kneeR', P.legR]]) {
      const ratio = depth(pose, k) / r
      if (ratio > worst) { worst = ratio; who = `${n} ${k}` }
    }
  }
  check('八款預設都不會被誤判', worst < 0.8, `最深為自身半徑的 ${(worst*100).toFixed(0)}%（${who}）`)
}

console.log('\n【手肘折彎方向的解剖學基準】')
{
  // 人的手肘一律往身體前方折。扭轉 0 時的折彎方向必須等於「軀幹正前方投影到垂直於上臂的平面」
  const anat = u => {
    const dot = f => f[0]*u[0] + f[1]*u[1] + f[2]*u[2]
    let f = [0,1,0], b = [0,1,2].map(k => f[k] - dot(f)*u[k])
    if (Math.hypot(...b) < 0.15) { f = [0,0,1]; b = [0,1,2].map(k => f[k] - dot(f)*u[k]) }
    return SK.norm(b)
  }
  let worst = 0, at = ''
  for (let p = -60; p <= 180; p += 10) for (let o = -40; o <= 180; o += 10) {
    const raw = SK.KEYS.reduce((a,k)=>(a[k]=0,a),{})
    raw.armPitchL = p; raw.armOutL = o; raw.elbowL = 90
    const J = SK.fk(raw).joints
    const inv = SK.tp(J.Mwaist)
    const fore = SK.ap(inv, SK.norm(SK.sub(J.handL, J.elbowL)))
    const u = SK.ap(inv, SK.norm(SK.sub(J.elbowL, J.shoulderL)))
    const a = anat(u)
    const ang = Math.acos(SK.clamp(fore[0]*a[0] + fore[1]*a[1] + fore[2]*a[2], -1, 1)) * 180 / Math.PI
    if (ang > worst) { worst = ang; at = `前後擺 ${p}° 外展 ${o}°` }
  }
  check('扭轉 0 時折彎方向永遠是解剖學方向', worst < 1, `最大偏差 ${worst.toFixed(2)}° @ ${at}`)

  // 舊模型在手臂舉高時整整差 180°，用它證明這個檢查有效
  {
    const A = SK.rotM(170, 0, 0)
    const base = SK.elbowTwistBase(A) * 180 / Math.PI
    check('舊模型的預設方向確實差很多', Math.abs(Math.abs(base) - 180) < 5,
          `舉高時基準角 ${base.toFixed(0)}°，代表舊模型反了 180°`)
  }

  // ±90 的上限意味著折彎方向最多偏到側面，永遠不會翻到身體後方
  {
    let posterior = 0
    for (let p = -60; p <= 180; p += 15) for (let o = -40; o <= 180; o += 15)
      for (const tw of [-90, -45, 0, 45, 90]) {
        const raw = SK.KEYS.reduce((a,k)=>(a[k]=0,a),{})
        raw.armPitchL = p; raw.armOutL = o; raw.armTwistL = tw; raw.elbowL = 90
        const J = SK.fk(raw).joints
        const inv = SK.tp(J.Mwaist)
        const fore = SK.ap(inv, SK.norm(SK.sub(J.handL, J.elbowL)))
        const u = SK.ap(inv, SK.norm(SK.sub(J.elbowL, J.shoulderL)))
        const a = anat(u)
        const ang = Math.acos(SK.clamp(fore[0]*a[0] + fore[1]*a[1] + fore[2]*a[2], -1, 1)) * 180 / Math.PI
        if (ang > 91) posterior++
      }
    check('折彎方向永遠不會翻到身體後方', posterior === 0, `違規 ${posterior} 次`)
  }
}

console.log('\n【手掌拖曳：扭轉與彎曲一起解】')
{
  let fail = 0, worst = 0
  for (let i = 0; i < 8000; i++) {
    const sx = Math.random() < 0.5 ? -1 : 1
    const side = sx < 0 ? 'L' : 'R'
    const raw = SK.KEYS.reduce((a,k)=>(a[k]=0,a),{})
    raw.waistPitch = Math.random()*80 - 30
    raw['armPitch'+side] = Math.random()*240 - 60
    raw['armOut'+side]   = Math.random()*220 - 40
    raw['armTwist'+side] = Math.random()*180 - 90
    raw['elbow'+side]    = Math.random()*150
    const J = SK.fk(raw).joints
    const dir = SK.norm(SK.sub(J['hand'+side], J['elbow'+side]))
    const r = SK.solveArmHand(J['Aup'+side], J['twistBase'+side], dir, sx)
    if (r.twist === null) continue
    const raw2 = { ...raw }
    raw2['armTwist'+side] = r.twist
    raw2['elbow'+side] = r.elbow
    const J2 = SK.fk(raw2).joints
    const d2 = SK.norm(SK.sub(J2['hand'+side], J2['elbow'+side]))
    const err = Math.hypot(dir[0]-d2[0], dir[1]-d2[1], dir[2]-d2[2])
    worst = Math.max(worst, err)
    if (err > 1e-9) fail++
  }
  check('前臂方向往返 8000 次完全還原', fail === 0, `最大誤差 ${worst.toExponential(1)}`)

  // 只解肘的舊做法只能在一個平面上繞，同時解扭轉才到得了任意方向
  {
    const raw = SK.clonePose({ armPitchR: 40, armOutR: 70, armTwistR: -60, elbowR: 90 })
    const J = SK.fk(raw).joints
    const target = [J.elbowR[0], J.elbowR[1] + 2, J.elbowR[2]]
    const want = SK.norm(SK.sub(target, J.elbowR))
    const only = SK.clamp(SK.solve1(J.MupR, SK.sub(target, J.elbowR)), 0, 150)
    const both = SK.solveArmHand(J.AupR, J.twistBaseR, SK.sub(target, J.elbowR), 1)
    const dirOf = (tw, eb) => {
      const p = { ...raw, armTwistR: tw, elbowR: eb }
      const j = SK.fk(p).joints
      return SK.norm(SK.sub(j.handR, j.elbowR))
    }
    const eOnly = Math.hypot(...SK.sub(dirOf(raw.armTwistR, only), want))
    const eBoth = Math.hypot(...SK.sub(dirOf(SK.clamp(both.twist,-90,90), SK.clamp(both.elbow,0,150)), want))
    check('同時解扭轉比只解肘更準', eBoth < eOnly * 0.5, `只解肘 ${eOnly.toFixed(2)}，同時解 ${eBoth.toFixed(3)}`)
  }
}

console.log('\n【STL 匯出】')
async function bbox(blob){
  const b = Buffer.from(await blob.arrayBuffer())
  const n = b.readUInt32LE(80)
  const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9]; let deg=0
  for(let i=0;i<n;i++){ const o=84+i*50; const v=[]
    for(let k=0;k<3;k++){ const p=[b.readFloatLE(o+12+k*12),b.readFloatLE(o+16+k*12),b.readFloatLE(o+20+k*12)]
      v.push(p); for(let j=0;j<3;j++){ if(p[j]<mn[j])mn[j]=p[j]; if(p[j]>mx[j])mx[j]=p[j] } }
    const A=[v[1][0]-v[0][0],v[1][1]-v[0][1],v[1][2]-v[0][2]], B=[v[2][0]-v[0][0],v[2][1]-v[0][1],v[2][2]-v[0][2]]
    if(Math.hypot(A[1]*B[2]-A[2]*B[1],A[2]*B[0]-A[0]*B[2],A[0]*B[1]-A[1]*B[0])<1e-12) deg++ }
  return {n,mn,mx,deg}
}
for (const [name,p] of Object.entries(PRESETS)) {
  const pose = SK.clonePose(p)
  const r = exportSTL(pose, 3.1, { tolerance: 0.05, floor: 24 })
  const v = await bbox(r.blob)
  const size=[v.mx[0]-v.mn[0],v.mx[1]-v.mn[1],v.mx[2]-v.mn[2]]
  const ok = Math.abs(v.mn[2])<1e-3 && Math.abs(v.mn[0]+v.mx[0])<1e-3 && Math.abs(v.mn[1]+v.mx[1])<1e-3
    && v.deg===0 && size.every((s,i)=>Math.abs(s-[r.size.x,r.size.y,r.size.z][i])<1e-3)
  check(name.padEnd(10), ok, `${size.map(s=>s.toFixed(2)).join('×')} mm  ${v.n} 面  ${(r.bytes/1024).toFixed(0)} KB`)
}
{
  const t0=Date.now(); exportSTL(SK.clonePose(PRESETS['07 側躺']), 25, { tolerance: 0.02, floor: 64 }); const dt=Date.now()-t0
  check('大模型(50mm 頭)高品質匯出耗時', dt < 15000, `${dt} ms，${segmentsFor(25,0.02,64)} 段`)
}
console.log('\n【底座】')
{
  // 用最窄的預設，底座直徑才會明顯大過人偶本身
  const pose = SK.clonePose(PRESETS['03 直立'])
  const noBase = exportSTL(pose, 3.1, { tolerance: 0.05, floor: 24 })
  const withBase = exportSTL(pose, 3.1, { tolerance: 0.05, floor: 24, baseDiameter: 20 })
  const v = await bbox(withBase.blob)
  check('加底座後貼齊列印平台', Math.abs(v.mn[2]) < 1e-3, `最低 z=${v.mn[2].toFixed(4)}`)
  check('底座位於底部而非腰部', (v.mx[0]-v.mn[0]) > 19.9 && (v.mx[1]-v.mn[1]) > 19.9,
        `XY 範圍 ${(v.mx[0]-v.mn[0]).toFixed(1)} × ${(v.mx[1]-v.mn[1]).toFixed(1)}（底座 20 mm）`)
  check('底座讓外框變寬但不變高', withBase.size.x >= 20 && Math.abs(withBase.size.z - noBase.size.z) < 1e-6)
  check('底座不影響不加底座時的結果', Math.abs(noBase.size.x - withBase.size.x) > 0.5,
        `無底座 ${noBase.size.x.toFixed(1)}，有底座 ${withBase.size.x.toFixed(1)}`)
  check('底座三角面有被加進去', withBase.triangles > noBase.triangles)
}

console.log('\n【列印可行性】')
{
  const A = (pose, hd = 6.2) => PR.analysePrintability(SK.clonePose(pose), hd / 2);

  // 垂直的肢體底面自己撐得住，不該被判需要支撐
  check('直立免支撐', A(PRESETS['03 直立']).level === 'none');
  check('仰躺免支撐', A(PRESETS['06 仰躺']).level === 'none');
  check('雙手上舉免支撐', A({ armPitchL: 170, armPitchR: 170 }).level === 'none');

  // 水平伸出且下方是空的，必須判出來
  const tpose = A({ armOutL: 90, armOutR: 90 });
  check('手平舉判為需要支撐', tpose.level === 'heavy', `${tpose.area.toFixed(1)} mm²`);
  check('手平舉指出的是手臂', tpose.parts.some(p => p.key.includes('Arm')) &&
        !tpose.parts.some(p => p.key.includes('Leg')), tpose.parts.map(p => p.name).join('、'));
  const legUp = A({ hipPitchL: 90, kneeL: 0 });
  check('單腳前抬指出的是腿', legUp.level === 'heavy' && legUp.parts.every(p => p.key.includes('Leg')),
        legUp.parts.map(p => p.name).join('、'));

  // 關鍵：01 的前臂幾乎水平，但它壓在頭上，射線打得到實體 → 不該算需要支撐
  {
    const pose = SK.clonePose(PRESETS['01 舉手抱頭']);
    const { joints: J } = SK.fk(pose);
    const d = [J.handR[0]-J.elbowR[0], J.handR[1]-J.elbowR[1], J.handR[2]-J.elbowR[2]];
    const L = Math.hypot(...d);
    const flat = Math.sqrt(Math.max(0, 1 - (d[2]/L) ** 2));
    check('01 前臂確實接近水平', flat > 0.707, `cos(仰角) = ${flat.toFixed(2)}`);
    check('但因為壓在頭上而免支撐', A(PRESETS['01 舉手抱頭']).level === 'none',
          '證明往下打射線的判定有作用');
  }

  // 換尺寸時判定要一致（面積本身會隨尺寸平方成長，門檻也跟著縮放）
  for (const name of ['03 直立', '02 雙手歡呼', '07 側躺', '08 大字型']) {
    const levels = [4, 6.2, 10, 20, 40].map(hd => A(PRESETS[name], hd).level);
    check(`${name.padEnd(10)} 各尺寸判定一致`, new Set(levels).size === 1, levels.join(' '));
    const areas = [6.2, 12.4].map(hd => A(PRESETS[name], hd).area);
    if (areas[0] > 0.1)
      check(`${name.padEnd(10)} 面積隨尺寸平方成長`, Math.abs(areas[1] / areas[0] - 4) < 0.15,
            `倍率 ${(areas[1] / areas[0]).toFixed(2)}（應為 4）`);
  }

  check('敘述保留「以目前姿態」前提', ['03 直立','02 雙手歡呼'].every(n => A(PRESETS[n]).label.includes('以目前姿態')),
        A(PRESETS['03 直立']).label);
  check('免支撐時不附加細節', A(PRESETS['03 直立']).detail === '');
  check('需支撐時有指出部位與做法', /懸空|水平/.test(A({ armOutL: 90, armOutR: 90 }).detail));
  {
    const t0 = Date.now();
    for (const pre of Object.values(PRESETS)) A(pre);
    const dt = Date.now() - t0;
      check('八款分析總耗時可接受', dt < 400, `${dt} ms`);
  }
  // 預設動作是給學生的起點，不該一開始就要開支撐
  {
    const heavy = Object.entries(PRESETS).filter(([, pre]) => A(pre).level === 'heavy');
    check('沒有任何預設需要支撐', heavy.length === 0, heavy.map(([n]) => n).join('、') || '無');
    for (const [n, pre] of Object.entries(PRESETS))
      check(`${n.padEnd(10)} 以目前姿態可直接列印`, A(pre).level !== 'heavy',
            `${A(pre).area.toFixed(1)} mm²`);
    // 外展上限要能讓上臂舉到 45° 以上，否則免支撐的歡呼動作擺不出來
    const maxElev = Math.asin(Math.abs(-Math.cos(SK.LIMITS.armOut[1] * Math.PI / 180))) * 180 / Math.PI;
    check('外展上限足以讓上臂超過 45°', SK.LIMITS.armOut[1] >= 135,
          `上限 ${SK.LIMITS.armOut[1]}° → 上臂最高仰角 ${maxElev.toFixed(0)}°`);
  }

  console.log('\n【關節範圍是否符合人體 ROM】');
  {
    // 臨床常用區間的寬端。誤差 ±15° 內視為相符（各家量測標準略有差異）
    const ROM = {
      armPitch:   [-60, 180], armOut: [-40, 180], armTwist: [-90, 90], elbow: [0, 150],
      hipPitch:   [-30, 130], hipOut: [-30, 50],  knee:  [0, 150],
      waistPitch: [-30, 80],  waistTwist: [-45, 45]
    };
    for (const [k, [lo, hi]] of Object.entries(ROM)) {
      const cur = SK.LIMITS[k];
      check(`${k.padEnd(11)} 符合人體可動範圍`,
            Math.abs(cur[0] - lo) <= 15 && Math.abs(cur[1] - hi) <= 15,
            `目前 [${cur}]，參考 [${lo}, ${hi}]`);
    }
    check('頭部錐角接近頸部可動範圍', SK.HEAD_TILT_MAX >= 40 && SK.HEAD_TILT_MAX <= 50,
          `${SK.HEAD_TILT_MAX}°，頸部前彎 50 / 側彎 45`);
    // 扭轉超過 ±90 會讓手肘往反方向折，屬於人體做不到的動作
    check('臂・扭轉不超過 ±90（避免手肘反折）', Math.abs(SK.LIMITS.armTwist[0]) <= 90 && SK.LIMITS.armTwist[1] <= 90);
    check('整體擺放方向保留完整 360°', SK.LIMITS.rootPitch[1] === 180 && SK.LIMITS.rootRoll[1] === 180);
  }
}

console.log('\n【分享連結】')
{
  for (const [name, pre] of Object.entries(PRESETS)) {
    const st = { pose: SK.clonePose(pre), headDiameter: 6.2, baseDiameter: 0 }
    const dec = SH.decodeState('#' + SH.encodeState(st))
    const same = dec && SK.KEYS.every(k => Math.round(st.pose[k]) === dec.pose[k])
    check(`${name.padEnd(10)} 連結往返一致`, same)
  }
  {
    const st = { pose: SK.clonePose(PRESETS['07 側躺']), headDiameter: 18.4, baseDiameter: 25 }
    const dec = SH.decodeState('#' + SH.encodeState(st))
    check('尺寸與底座一併帶過去', dec.headDiameter === 18.4 && dec.baseDiameter === 25,
          `頭 ${dec.headDiameter}、底座 ${dec.baseDiameter}`)
    check('網址長度合理', SH.encodeState(st).length < 90, `${SH.encodeState(st).length} 字元`)
  }
  const bad = ['', '#', '#p=1,2,3', '#h=6', '#p=a,b,c', '#p=' + Array(19).fill(0).join(','), null]
  check('壞掉的網址一律安全忽略', bad.every(h => SH.decodeState(h) === null))
  {
    const zeros = '#p=' + Array(SK.KEYS.length).fill(0).join(',')
    check('頭部直徑受下限保護', SH.decodeState(zeros + '&h=1').headDiameter === SH.HEAD_MIN,
          `輸入 1 → ${SH.decodeState(zeros + '&h=1').headDiameter}`)
    check('頭部直徑受上限保護', SH.decodeState(zeros + '&h=999').headDiameter === SH.HEAD_MAX)
    const wild = '#p=' + SK.KEYS.map(k => k === 'hipPitchL' ? -999 : 0).join(',')
    check('超範圍角度會被收束', SH.decodeState(wild).pose.hipPitchL === SK.LIMITS.hipPitch[0],
          `−999 → ${SH.decodeState(wild).pose.hipPitchL}`)
  }
  const html = fs.readFileSync('index.html', 'utf8')
  check('滑桿下限已改為 4 mm', /id="headDia"[^>]*min="4"/.test(html))
}

console.log('\n【高解析螢幕的畫布尺寸】')
{
  // 這一組是為了防止一個只在 pixelRatio > 1 的裝置上才會發作的迴歸：
  // renderer.setSize(w, h, false) 不會寫 CSS 尺寸，畫布會被放大成容器的 pixelRatio 倍，
  // 再被 overflow:hidden 裁掉，人偶就跑出可見範圍。桌機（pixelRatio 1）完全看不出來。
  const viewer = fs.readFileSync('src/viewer3d.js', 'utf8')
  const calls = viewer.match(/setSize\([^)]*\)/g) || []
  check('renderer.setSize 沒有關閉 CSS 尺寸更新', calls.length > 0 && calls.every(c => !/false/.test(c)),
        calls.join(' / '))
  const html2 = fs.readFileSync('index.html', 'utf8')
  check('畫布另有 CSS 尺寸兜底', /#view3d canvas\{[^}]*width:100%[^}]*height:100%/.test(html2))
  check('窄螢幕的視圖高度較低', /clamp\(300px, 40vh, 420px\)/.test(html2))
  check('寬螢幕才放大到 52vh', /min-width:900px\)\{[\s\S]{0,200}52vh/.test(html2))
}

console.log('\n【UI 串接】')
{
  const dom = new JSDOM(fs.readFileSync('index.html','utf8'), { pretendToBeVisual:true })
  const { window } = dom
  global.window=window; global.document=window.document
  Object.defineProperty(global,'navigator',{value:window.navigator,configurable:true})
  global.requestAnimationFrame=()=>0; window.devicePixelRatio=1
  var c2d = new Proxy({}, { get:(t,k)=> k==='canvas'?{}:()=>{} })
  window.HTMLCanvasElement.prototype.getContext = t => t==='2d'?c2d:null
  window.Element.prototype.getBoundingClientRect = () => ({width:400,height:330,left:0,top:0})
  window.HTMLCanvasElement.prototype.setPointerCapture = ()=>{}
  await import('../src/main.js')
  const $ = id => document.getElementById(id)
  check('WebGL 不可用時仍能運作', $('view3d').textContent.includes('WebGL'))
  check('八款預設按鈕已建立', $('presetRow').children.length===8)
  check('姿態滑桿已建立', $('sliders').querySelectorAll('input').length===6)
  ;[...$('presetRow').children].find(b=>b.dataset.name.startsWith('08')).click()
  {
    const expect = (SK.boundingBox(SK.clonePose(PRESETS['08 大字型'])).size[0] * 3.1).toFixed(1)
    check('切換預設會更新外框', $('sizeBox').textContent.startsWith(expect), $('sizeBox').textContent)
  }
  const hd=$('headDia'); hd.value='12'; hd.dispatchEvent(new window.Event('input'))
  check('改頭部直徑會等比放大',
        $('sizeStand').textContent===(SK.STANDING_H*6).toFixed(1)+' mm', $('sizeStand').textContent)
  const cv=$('cvFront')
  const pe=(t,x,y)=>{const e=new window.Event(t,{bubbles:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1,preventDefault(){}});return e}
  ;[...$('presetRow').children].find(b=>b.dataset.name.startsWith('03')).click()
  // 由實際關節位置換算控制點的螢幕座標，體型比例改變時測試才不會失效
  const { FRAME } = await import('../src/editor2d.js')
  const SC = Math.min(400/FRAME.wDiv, 330/FRAME.hDiv), CX = 200, CY = 330*FRAME.cyRatio
  const toS = p => [CX + (-p[0])*SC, CY - p[2]*SC]
  const elbow = toS(SK.fk(SK.clonePose(PRESETS['03 直立'])).joints.elbowL)
  cv.dispatchEvent(pe('pointerdown', elbow[0], elbow[1]))
  cv.dispatchEvent(pe('pointermove', elbow[0]+3.0*SC, elbow[1]-1.5*SC))
  cv.dispatchEvent(pe('pointerup',0,0))
  const after=JSON.parse($('code').value)
  check('拖曳控制點會改變姿勢', after.armOutL!==7 || after.armPitchL!==0, `armOutL=${after.armOutL} armPitchL=${after.armPitchL}`)
  check('拖曳後取消預設高亮', ![...$('presetRow').children].some(b=>b.classList.contains('on')))
  // 把膝蓋控制點往正後方拖很遠，髖後擺應被限制值擋住
  const cvS = $('cvSide')
  const toSide = p => [CX + p[1]*SC, CY - p[2]*SC]
  const knee = toSide(SK.fk(JSON.parse($('code').value)).joints.kneeL)
  cvS.dispatchEvent(pe('pointerdown', knee[0], knee[1]))
  cvS.dispatchEvent(pe('pointermove', knee[0] - 6*SC, knee[1] - 1.0*SC))
  cvS.dispatchEvent(pe('pointerup',0,0))
  const hp = JSON.parse($('code').value).hipPitchL
  check('拖曳時髖後擺受限制', hp >= SK.LIMITS.hipPitch[0], `hipPitchL=${hp}，下限 ${SK.LIMITS.hipPitch[0]}`)
  check('分享連結欄位有填入', /#p=/.test($('shareUrl').value), $('shareUrl').value.slice(-40))

  // 列印難度提示條
  ;[...$('presetRow').children].find(b => b.dataset.name.startsWith('03')).click()
  check('直立時提示條為綠色', $('printability').className.includes('ok'), $('printability').textContent)
  // 八款預設現在都免支撐，所以改用一個手平舉的自訂姿勢來驗證紅燈與虛線
  Object.assign(window.__poser.state.pose, SK.clonePose({ armOutL: 90, armOutR: 90 }))
  window.__poser.refresh()
  check('手平舉時提示條轉紅', $('printability').className.includes('bad'), $('printability').textContent)
  check('紅色時會標出懸空肢體', window.__poser.editor.highlight.size > 0,
        [...window.__poser.editor.highlight].join(','))
  ;[...$('presetRow').children].find(b => b.dataset.name.startsWith('06')).click()
  check('切回免支撐姿勢時虛線清空', window.__poser.editor.highlight.size === 0)

  // 微調鈕：每根滑桿左右各一顆，按一下走一格
  {
    const rows = [...$('sliders').querySelectorAll('.sl'), ...document.querySelectorAll('.sl')]
    const uniq = [...new Set(rows)]
    const ok = uniq.every(r => r.querySelectorAll('button.step').length === 2)
    check('每根滑桿兩側都有微調鈕', ok && uniq.length === 8, `${uniq.length} 根滑桿`)

    const press = btn => {
      const e = new window.Event('pointerdown', { bubbles: true })
      e.preventDefault = () => {}
      btn.dispatchEvent(e)
      btn.dispatchEvent(new window.Event('pointerup', { bubbles: true }))
    }
    // 角度：一格 1 度
    ;[...$('presetRow').children].find(b => b.dataset.name.startsWith('03')).click()
    const row = $('sliders').querySelector('.sl')
    const [minus, plus] = row.querySelectorAll('button.step')
    const before = JSON.parse($('code').value).rootPitch
    press(plus); press(plus); press(plus)
    const after = JSON.parse($('code').value).rootPitch
    check('按 + 三下角度加 3 度', after === before + 3, `${before} → ${after}`)
    press(minus)
    check('按 − 一下角度減 1 度', JSON.parse($('code').value).rootPitch === after - 1)

    // 小數 step 不能累積浮點誤差
    const hd = $('headDia')
    hd.value = '6.2'; hd.dispatchEvent(new window.Event('input'))
    const hplus = hd.nextElementSibling
    for (let i = 0; i < 4; i++) press(hplus)
    check('頭部直徑 0.2 mm 一格且無浮點誤差', hd.value === '7.0', `6.2 加四格 → ${hd.value}`)

    // 到達上下限就停住
    const bd = $('baseDia')
    const bminus = bd.previousElementSibling
    bd.value = '1'; bd.dispatchEvent(new window.Event('input'))
    press(bminus); press(bminus); press(bminus)
    check('觸底後不會變成負值', +bd.value === 0, `底座 ${bd.value}`)
  }
}

console.log('\n【從網址載入】')
{
  // 換一份乾淨的 document，網址先帶好 hash，確認 main.js 啟動時會採用
  const target = SK.clonePose(PRESETS['08 大字型'])
  const hash = '#' + SH.encodeState({ pose: target, headDiameter: 11.4, baseDiameter: 0 })
  const dom2 = new JSDOM(fs.readFileSync('index.html', 'utf8'),
    { pretendToBeVisual: true, url: 'https://example.org/app/' + hash })
  const w2 = dom2.window
  global.window = w2; global.document = w2.document
  Object.defineProperty(global, 'navigator', { value: w2.navigator, configurable: true })
  w2.devicePixelRatio = 1
  w2.HTMLCanvasElement.prototype.getContext = t => t === '2d' ? c2d : null
  w2.Element.prototype.getBoundingClientRect = () => ({ width: 400, height: 330, left: 0, top: 0 })
  w2.HTMLCanvasElement.prototype.setPointerCapture = () => {}
  await import('../src/main.js?reload=' + Date.now())
  const $$ = id => w2.document.getElementById(id)
  const loaded = JSON.parse($$('code').value)
  check('網址中的姿勢有被套用', SK.KEYS.every(k => Math.round(target[k]) === loaded[k]))
  check('網址中的尺寸有被套用', $$('headDiaVal').textContent === '11.4 mm', $$('headDiaVal').textContent)
  check('從網址載入時不高亮預設', ![...$$('presetRow').children].some(b => b.classList.contains('on')))
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`)
process.exit(fail?1:0)
