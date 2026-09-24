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

module.exports = { t, assert, assertEq, HZ: sandbox.HZ, sandbox, finish(){
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}};
// 偏差（计划未写）：计划期望输出形如 "1 passed, 0 failed"，需要调用 finish()
module.exports.finish();
