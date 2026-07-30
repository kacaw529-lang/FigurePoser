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

let pass = 0, fail = 0
const check = (name, ok, extra='') => { ok ? pass++ : fail++; console.log(`${ok?'✓':'✗'} ${name}${extra?'  '+extra:''}`) }

console.log('【幾何約束】')
const P = SK.P
check('肩球頂不高於軀幹頂面', P.shoulderZ + P.armR <= P.torsoH, `餘裕 ${(P.torsoH-P.shoulderZ-P.armR).toFixed(3)}`)
check('頭球底部埋入軀幹',      P.headPivotZ + P.headDist - P.headR < P.torsoH, `埋入 ${(P.torsoH-(P.headPivotZ+P.headDist-P.headR)).toFixed(3)}`)
check('髖球未穿出軀幹底面',    P.hipZ - P.legR >= 0, `餘裕 ${(P.hipZ-P.legR).toFixed(3)}`)
check('髖球未穿出軀幹側面',    P.hipX + P.legR <= P.torsoW/2, `餘裕 ${(P.torsoW/2-P.hipX-P.legR).toFixed(3)}`)
{
  const pose = SK.clonePose(null); pose.headPitch = SK.HEAD_TILT_MAX
  const J = SK.fk(pose).joints
  check('頭傾到極限仍埋入軀幹', J.head[2]-P.headR < P.torsoH && Math.abs(J.head[1]) < P.torsoD/2,
        `頭底 ${(J.head[2]-P.headR).toFixed(2)} < ${P.torsoH}`)
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
  check('頭部傾角受 30° 限制', over===0, `超出 ${over}`)
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
  const pose = SK.clonePose(PRESETS['01 舉手抱頭'])
  const noBase = exportSTL(pose, 3.1, { tolerance: 0.05, floor: 24 })
  const withBase = exportSTL(pose, 3.1, { tolerance: 0.05, floor: 24, baseDiameter: 14 })
  const v = await bbox(withBase.blob)
  check('加底座後貼齊列印平台', Math.abs(v.mn[2]) < 1e-3, `最低 z=${v.mn[2].toFixed(4)}`)
  check('底座位於底部而非腰部', (v.mx[0]-v.mn[0]) > 13.9 && (v.mx[1]-v.mn[1]) > 13.9,
        `XY 範圍 ${(v.mx[0]-v.mn[0]).toFixed(1)} × ${(v.mx[1]-v.mn[1]).toFixed(1)}（底座 14 mm）`)
  check('底座讓外框變寬但不變高', withBase.size.x >= 14 && Math.abs(withBase.size.z - noBase.size.z) < 1e-6)
  check('底座不影響不加底座時的結果', noBase.size.x < 14)
  check('底座三角面有被加進去', withBase.triangles > noBase.triangles)
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
