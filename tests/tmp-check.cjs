const { chooseMove } = require('../src/gobang-ai.js');
const SIZE = 15;
const newBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
const flip = (b) => b.map((row) => row.map((v) => (v === 0 ? 0 : v === 1 ? 2 : 1)));
const inFive = (b, r, c) => {
    const p = b[r][c];
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let n = 1;
        for (const s of [1, -1]) for (let i = 1; i < 5; i++) {
            const nr = r + dr * i * s, nc = c + dc * i * s;
            if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || b[nr][nc] !== p) break;
            n++;
        }
        if (n >= 5) return true;
    }
    return false;
};

// ---- 性能：让两个 medium 自行走到第 N 手，得到「无立即成五」的真实中局，再单独计时 ----
function buildMidGame(plies, seed) {
    const b = newBoard();
    let rnd = seed;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
    for (let t = 0; t < plies; t++) {
        const isBlack = t % 2 === 0;
        const m = chooseMove(isBlack ? flip(b) : b, 'medium', rand);
        if (!m) break;
        b[m.row][m.col] = isBlack ? 1 : 2;
        if (inFive(b, m.row, m.col)) return null;      // 已分胜负，局面不可用
    }
    return b;
}

// 确认该局面对白方不存在一步成五（否则会走硬规则，测不到搜索耗时）
function hasImmediateWinFor(b, player) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (b[r][c] !== 0) continue;
        b[r][c] = player;
        const w = inFive(b, r, c);
        b[r][c] = 0;
        if (w) return true;
    }
    return false;
}

console.log('各难度在真实中局的单步耗时（避开可一步成五的局面，取多局面最大值）:\n');
const samples = [];
for (const plies of [10, 14, 18, 22, 26]) {
    for (const seed of [13, 997, 20240]) {
        const b = buildMidGame(plies, seed);
        if (!b) continue;
        if (hasImmediateWinFor(b, 2) || hasImmediateWinFor(b, 1)) continue;
        samples.push(b);
    }
}
console.log(`  可用样本局面 ${samples.length} 个\n`);
for (const d of ['easy', 'medium', 'hard']) {
    let mx = 0, sum = 0, n = 0;
    for (const b of samples) {
        const t0 = Date.now();
        chooseMove(b.map(r => r.slice()), d, () => 0.5);
        const dt = Date.now() - t0;
        mx = Math.max(mx, dt); sum += dt; n++;
    }
    console.log(`  ${d.padEnd(6)} 平均 ${(sum / n).toFixed(1).padStart(5)}ms   最慢 ${String(mx).padStart(3)}ms`);
}

// ---- 棋力：循环赛 ----
const wins = { easy: 0, medium: 0, hard: 0 };
const played = { easy: 0, medium: 0, hard: 0 };
for (const seedBase of [13, 997, 20240]) {
    for (const [b, w] of [['easy', 'hard'], ['hard', 'easy'], ['easy', 'medium'],
        ['medium', 'easy'], ['medium', 'hard'], ['hard', 'medium']]) {
        for (let i = 0; i < 4; i++) {
            const board = newBoard();
            let rnd = seedBase + i * 7919;
            const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
            played[b]++; played[w]++;
            let done = false;
            for (let t = 0; t < SIZE * SIZE && !done; t++) {
                const isBlack = t % 2 === 0;
                const m = chooseMove(isBlack ? flip(board) : board, isBlack ? b : w, rand);
                if (!m) break;
                board[m.row][m.col] = isBlack ? 1 : 2;
                if (inFive(board, m.row, m.col)) {
                    wins[isBlack ? b : w]++;
                    done = true;
                }
            }
        }
    }
}
console.log('\n三档循环赛（3 组种子 × 24 局 = 72 局）:\n');
for (const [k, v] of Object.entries(wins).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(6)} ${String(v).padStart(2)} / ${played[k]} 胜   胜率 ${((v / played[k]) * 100).toFixed(0).padStart(3)}%`);
}
