// 冒烟测试：成语接龙本地校验（macOS 自带 JavaScriptCore，无需 node）
// 用法：在仓库根目录执行  osascript -l JavaScript tests/idiom-chain.test.js
// 1) 编译 idiom.html 内联脚本（仅编译，不执行，查语法错误）
// 2) 加载 src/pinyin-dict.js，提取页面里真实的 charsMatch/pinyinsOf/judgeAiTake 源码并执行
// 3) 用 2026-08-26 截图中的真实对局场景做断言
ObjC.import('Foundation');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
  if (!s) throw new Error('cannot read ' + p);
  return s.js;
}

var out = [];
var failed = 0;
function assert(name, cond) {
  if (cond) { out.push('PASS ' + name); }
  else { failed++; out.push('FAIL ' + name); }
}

var HTML = 'src/newTools/idiom.html';   // 相对仓库根目录
var DICT = 'src/pinyin-dict.js';
var html = readFile(HTML);

// ---- 1) 语法编译内联脚本 ----
var start = html.lastIndexOf('<script>');
var end = html.lastIndexOf('</script>');
var inline = html.substring(start + '<script>'.length, end);
try {
  new Function(inline);
  out.push('PASS syntax: inline script compiles');
} catch (e) {
  failed++;
  out.push('FAIL syntax: ' + e.message);
}

// ---- 2) 提取页面真实的校验函数源码 ----
function sliceBetween(src, fromMark, toMark) {
  var i = src.indexOf(fromMark);
  var j = src.indexOf(toMark, i);
  if (i < 0 || j < 0) throw new Error('marker not found: ' + fromMark + ' / ' + toMark);
  return src.substring(i, j);
}
var helpers = sliceBetween(html, '// ---------- 本地拼音 / 接龙校验 ----------', '// 先 escapeHtml');
var judgeFn = sliceBetween(html, '// 复核 AI 的接招成语是否合规', '// AI 连续犯错后的收尾');

var window = {};
eval(readFile(DICT));      // -> window.PINYIN_DICT
eval(helpers);             // -> pinyinsOf / charsMatch
var lastPlayerWord = '';
var usedWords = {};
eval(judgeFn);             // -> judgeAiTake

out.push('dict entries: ' + Object.keys(window.PINYIN_DICT).length);

// ---- 3) 截图场景回归 ----
assert('开局「一心一意」末字=意', window.PINYIN_DICT['意'] === 'yi');
assert('玩家接 一(yi)≈意(yi) 同音合规', charsMatch('意', '一') === true);
assert('AI 的 丝(si) 没接住 苟(gou) —— 截图主 bug', charsMatch('苟', '丝') === false);
assert('苟(gou)≈狗(gou) 同音可接', charsMatch('苟', '狗') === true);
assert('玩家 因(yin)≈音(yin) 合规 —— 被误判的那手', charsMatch('音', '因') === true);

// ---- 常规与多音字 ----
assert('大(da)≈答(da)', charsMatch('大', '答'));
assert('地(di) 不接 大(da)', !charsMatch('大', '地'));
assert('同字直连：心→心', charsMatch('心', '心'));
assert('多音字 还(huan/hai)≈环(huan)', charsMatch('还', '环'));
assert('多音字 长(chang/zhang)≈常(chang)', charsMatch('长', '常'));
assert('多音字 乐(le/yue)≈月(yue)', charsMatch('乐', '月'));
assert('字典外生僻字只认同字', charsMatch('囍', '囍') && !charsMatch('囍', '喜'));

// ---- judgeAiTake：复现截图里 AI 出牌复核 ----
lastPlayerWord = '一丝不苟';
usedWords = { '一心一意': true, '一丝不苟': true };   // 玩家提交时就已 markUsed
var fault = judgeAiTake('丝竹之音');
assert('judgeAiTake 拦截 丝竹之音（未接住末字苟）', !!fault && fault.indexOf('苟') !== -1);
fault = judgeAiTake('一丝不苟');
assert('judgeAiTake 拦截重复出牌', !!fault && fault.indexOf('出现过') !== -1);
assert('judgeAiTake 放行 苟且偷生', judgeAiTake('苟且偷生') === null);
lastPlayerWord = '';
usedWords = {};

console.log(out.join('\n'));
console.log(failed ? ('RESULT: ' + failed + ' FAILED') : 'RESULT: ALL PASS');
'RESULT printed';
