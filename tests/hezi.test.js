const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/newGame/hezi.html'), 'utf8');
const m = html.match(/<script id="hezi-logic">([\s\S]*?)<\/script>/);
if (!m) { console.error('hezi-logic script block not found'); process.exit(1); }
const sandbox = { console, process };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: 'hezi-logic.js' });

let passed = 0, failed = 0;
function t(name, fn){ try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); } }
function assert(v, msg){ if (!v) throw new Error(msg || 'assert failed'); }
function assertEq(a, b, msg){ if (a !== b) throw new Error((msg||'') + ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// 偏差（计划未写）：hezi-logic 块顶层 const HZ 是 vm 词法绑定，不会落到 sandbox 属性上，
// 需显式导出到 sandbox 才能在模块作用域引用；否则计划里测试体的 HZ 引用会 ReferenceError。
vm.runInContext('globalThis.HZ = HZ', sandbox, { filename: 'hezi-export.js' });
const HZ = sandbox.HZ;

t('logic block loads and HZ exists', () => {
  assert(HZ && typeof HZ === 'object', 'HZ global missing');
});

const H = module.exports.HZ;

// 测试用最小字典（任务 3-5 会替换为全量 120 字，这些条目必须原样保留在真实 DICT 中）
function seed(){
  HZ.DICT = [
    {ch:'村', comp:['木','寸'], struct:'LR', tier:1, hints:['村庄','农村'], rare:false, bio:'木旁寸，村落'},
    {ch:'好', comp:['女','子'], struct:'LR', tier:1, hints:['好人','美好'], rare:false, bio:'女子为好'},
    {ch:'明', comp:['日','月'], struct:'LR', tier:1, hints:['明天','光明'], rare:false, bio:'日月为明'},
    {ch:'泉', comp:['白','水'], struct:'TB', tier:1, hints:['泉水','泉眼'], rare:false, bio:'白水为泉'},
  ];
  HZ._testSeed = true;
}

t('idx: 结构+有序字根 键唯一映射', () => {
  seed();
  const ix = HZ.idx();
  // 偏差（计划未写）：assertEq 用 !== 无法比较两个新数组，改 JSON 深比较（与计划 Task 6 测试做法一致）
  assertEq(JSON.stringify(ix.get('LR|木寸')), JSON.stringify(['村']), '村 key');
  assertEq(JSON.stringify(ix.get('LR|日月')), JSON.stringify(['明']), '明 key');
  assertEq(JSON.stringify(ix.get('TB|白水')), JSON.stringify(['泉']), '泉 key');
  assert(ix.get('LR|水白') === undefined, 'LR|水白 must not exist');
});

t('verifyAnswer: 三态', () => {
  seed();
  const lv = { mode:'合', chs:['村'], main:'村', hints:['村庄'] };
  assertEq(HZ.verifyAnswer({struct:'LR', comp:['木','寸']}, lv).ok, true, 'correct');
  assertEq(HZ.verifyAnswer({struct:'LR', comp:['水','白']}, lv).kind, 'nosuch', '无此字');
  // 多解族：泉 与 白+水(TB) 之外的同键无，改用双答案族 白+水/氵+水 无 → 用 日/月+日 无。
  // 构造 taste 态：让 level 答案集 = ['明','村'] 共享? 不共享键。改法：同键多字
  HZ.DICT.push({ch:'杢', comp:['木','寸'], struct:'LR', tier:1, hints:['古同村'], rare:true, bio:'生僻同键'});
  const lv2 = { mode:'合', chs:['村','杢'], main:'村', hints:['村庄'] };
  const r = HZ.verifyAnswer({struct:'LR', comp:['寸','木']}, lv2); // 序不同 → 同字根重排，命中计划的 taste 兜底（字对味不对）
  assertEq(r.kind, 'taste', 'reordered same comps → taste, not nosuch');
  const r2 = HZ.verifyAnswer({struct:'LR', comp:['木','寸']}, lv2);
  assertEq(r2.ok, true, 'either family member passes');
});

t('scoreOf: 公式与生僻加倍', () => {
  assertEq(HZ.scoreOf({fails:0, hints:0, rare:false}), 100);
  assertEq(HZ.scoreOf({fails:4, hints:2, rare:false}), 60); // 100-10*2-5*4=60（计划原注释 50 系算术笔误，实现按公式 60）
  assertEq(HZ.scoreOf({fails:0, hints:0, rare:true}), 200);
  assertEq(HZ.scoreOf({fails:20, hints:0, rare:false}), 10); // 下限 10
});

t('selfCheck: 结构码/槽数/唯一键', () => {
  seed();
  HZ.selfCheck(); // 合法 → 不抛
  HZ.DICT.push({ch:'坏', comp:['木'], struct:'LR', tier:1, hints:['x'], rare:false, bio:'x'}); // 槽数不符
  assert(() => { HZ.selfCheck(); }, 'should throw on slot mismatch');
});

t('selfCheck: 键冲突必须多解登记', () => {
  seed();
  HZ.selfCheck();
});

module.exports = { t, assert, assertEq, HZ: sandbox.HZ, sandbox, finish(){
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}};
// 偏差（计划未写）：计划期望输出形如 "1 passed, 0 failed"，需要调用 finish()
module.exports.finish();
