const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const aiSrc = fs.readFileSync(path.join(root, 'src/gobang-ai.js'), 'utf8');

function makeEl() {
    const el = {
        className: '', textContent: '', onclick: null, children: [], checked: true, value: 'medium',
        classList: { add() {}, remove() {}, contains: () => false },
        appendChild(c) { this.children.push(c); return c; },
        addEventListener() {},
        querySelector: () => makeEl(),
        getContext: () => ctx2d(),
    };
    let _html = '';
    Object.defineProperty(el, 'innerHTML', {
        get: () => _html,
        set: (v) => { _html = v; el.children.length = 0; },
    });
    return el;
}
function ctx2d() {
    const noop = () => {};
    return new Proxy({}, {
        get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
        set: () => true,
    });
}

// 取页面中最长的一段内联脚本：gomoku.html 只有一段；
// gobang-game.html 还有一段很短的 tailwind.config，需要排除。
function inlineScript(html) {
    const all = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/g)];
    return all.map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
}

function makeSandbox() {
    const els = {};
    const listeners = {};
    const document = {
        getElementById: (id) => (els[id] ||= makeEl()),
        createElement: () => makeEl(),
        addEventListener: (ev, fn) => { listeners[ev] = fn; },
    };
    const sandbox = {
        document, setTimeout, clearTimeout, setInterval, clearInterval, console, Math,
        innerWidth: 1200, innerHeight: 800,
        history: { length: 1, back() {} },
        location: { href: '' },
        confirm: () => true,
    };
    sandbox.window = sandbox;
    const ctx = vm.createContext(sandbox);
    return { ctx, listeners, els };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    // ================= gomoku.html（脚本在顶层执行，可完整跑） =================
    {
        const { ctx, listeners } = makeSandbox();
        const html = fs.readFileSync(path.join(root, 'src/newGame/gomoku.html'), 'utf8');
        const code = inlineScript(html);

        vm.runInContext(aiSrc, ctx);
        assert.ok(ctx.GobangAI && typeof ctx.GobangAI.chooseMove === 'function',
            'GobangAI 应挂载到 window');
        console.log('[gomoku] GobangAI 已加载');

        vm.runInContext(code + `
            globalThis.__t = {
                get board() { return board; },
                setBoard(b) { board = b; },
                get currentPlayer() { return currentPlayer; },
                get gameOver() { return gameOver; },
                handleClick, init, getBestMove
            };
        `, ctx);
        const api = ctx.__t;

        const m = api.getBestMove();
        assert.ok(m && Number.isInteger(m.row), 'AI 应返回合法坐标');
        console.log(`[gomoku] AI 出招正常，空盘首手 (${m.row},${m.col})`);

        api.handleClick(7, 7);
        api.init();
        await sleep(800);
        assert.equal(api.board.flat().filter(Boolean).length, 0, 'A1 失败：重开后出现幽灵棋子');
        assert.equal(api.currentPlayer, 'B', 'A1 失败：回合被篡改');
        console.log('[gomoku] A1 重开竞态 —— 通过');

        api.init();
        api.handleClick(7, 7);
        await sleep(900);
        assert.equal(api.board.flat().filter(Boolean).length, 2, 'AI 未正常应手');
        console.log('[gomoku] AI 正常应手 —— 通过');

        const b = Array.from({ length: 15 }, (_, r) =>
            Array.from({ length: 15 }, (_, c) => ((r + c) % 2 === 0 ? 'W' : 'B')));
        b[7][7] = '';
        api.setBoard(b);
        api.handleClick(7, 7);
        assert.equal(api.gameOver, true, 'A5 失败：对局未结束');
        console.log('[gomoku] A5 平局 —— 通过');
    }

    console.log('');

    // ================= gobang-game.html（逻辑在 DOMContentLoaded 回调内） =================
    {
        const { ctx, listeners } = makeSandbox();
        const html = fs.readFileSync(path.join(root, 'src/gobang-game.html'), 'utf8');
        const code = inlineScript(html);

        vm.runInContext(aiSrc, ctx);

        // 在回调体结束前注入导出，把闭包内的状态暴露出来
        const marker = /\n[ \t]*\/\/ 初始化游戏/;
        assert.ok(marker.test(code), '未找到初始化锚点');
        const patched = code.replace(marker, (m) => '\n' + `
            globalThis.__t = {
                get board() { return gameBoard; },
                setBoard(b) { gameBoard = b; },
                get currentPlayer() { return currentPlayer; },
                get active() { return gameActive; },
                setDifficulty(d) { aiDifficulty = d; },
                aiChooseMove, resetGame, undoMove, canvasClick: (r, c) => {
                    gameBoard[r][c] = currentPlayer;
                    moveHistory.push({ row: r, col: c, player: currentPlayer });
                    currentPlayer = currentPlayer === 1 ? 2 : 1;
                    updateGameStatus();
                    if (currentPlayer === 2 && isAiEnabled) aiMakeMove();
                }
            };
` + m);

        vm.runInContext(patched, ctx);
        assert.ok(typeof listeners.DOMContentLoaded === 'function', '应注册 DOMContentLoaded');
        listeners.DOMContentLoaded();
        console.log('[gobang] 页面初始化成功');

        const api = ctx.__t;
        for (const d of ['easy', 'medium', 'hard']) {
            api.setDifficulty(d);
            api.setBoard(Array.from({ length: 15 }, () => Array(15).fill(0)));
            const mm = api.aiChooseMove();
            assert.ok(mm && Number.isInteger(mm.row), `${d} 应返回合法坐标`);
        }
        console.log('[gobang] 三档难度均能出招');

        // AI 应手：玩家落子后 AI 自动回应
        api.resetGame();
        api.setDifficulty('hard');
        api.canvasClick(7, 7);
        await sleep(1200);
        const n = api.board.flat().filter(Boolean).length;
        assert.equal(n, 2, `AI 未应手（棋盘上 ${n} 子）`);
        assert.equal(api.currentPlayer, 1, '回合应交还玩家');
        console.log('[gobang] AI 自动应手且回合交还 —— 通过');
    }

    console.log('\n两个页面端到端验证通过');
    process.exit(0);        // 页面内有 setInterval 计时器，需显式退出
})().catch((e) => {
    console.error('验证失败:', e.stack || e.message);
    process.exit(1);
});
