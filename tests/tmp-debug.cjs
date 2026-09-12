const { chooseMove, _debug } = require('../src/gobang-ai.js');
const { DIFFICULTY_SETTINGS } = _debug;
const SIZE = 15;
const B = (s) => {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (const [r, c, p] of s) b[r][c] = p;
  return b;
};
const flipB = (b) => b.map(row => row.map(v => v === 0 ? 0 : v === 1 ? 2 : 1));
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

const origMedium = { ...DIFFICULTY_SETTINGS.medium };
function moveWith(board, S, rand) {
  DIFFICULTY_SETTINGS.medium = S;
  const m = chooseMove(board, 'medium', rand);
  DIFFICULTY_SETTINGS.medium = origMedium;
  return m;
}

// A 用给定设置，B 用 easy 设置；双向各 games 局
function duel(S, games) {
  let winA = 0, winB = 0;
  for (let g = 0; g < games; g++) {
    for (const aIsBlack of [true, false]) {
      const b = B([]);
      let rnd = g * 7919 + 13;
      const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
      for (let t = 0; t < SIZE * SIZE; t++) {
        const isBlack = t % 2 === 0;
        const useA = isBlack === aIsBlack;
        const view = isBlack ? flipB(b) : b;
        const m = useA ? moveWith(view, S, rand) : chooseMove(view, 'easy', rand);
        if (!m) break;
        b[m.row][m.col] = isBlack ? 1 : 2;
        if (inFive(b, m.row, m.col)) {
          const aWon = (isBlack === aIsBlack);
          aWon ? winA++ : winB++;
          break;
        }
      }
    }
  }
  return { winA, winB };
}

const base = { ...origMedium };
const GAMES = 5;   // 双向 => 每组 10 局

console.log(`以 medium 参数为基准，逐项消融，对手固定为 easy（每组 ${GAMES * 2} 局）\n`);
const variants = [
  ['基准 medium (d3,w12,r2,rnd.12,combo)', {}],
  ['组合威胁关闭 combo=false', { useCombinations: false }],
  ['随机容差归零 randomness=0', { randomness: 0 }],
  ['宽度收窄 width=8', { width: 8 }],
  ['候选半径 radius=1', { candidateRadius: 1 }],
  ['深度回退 depth=1', { depth: 1 }],
  ['depth=4', { depth: 4 }],
];
for (const [name, patch] of variants) {
  const r = duel({ ...base, ...patch }, GAMES);
  const pct = ((r.winA / (r.winA + r.winB)) * 100).toFixed(0);
  console.log(`  ${name.padEnd(40)} 胜 ${String(r.winA).padStart(2)} / 负 ${String(r.winB).padStart(2)}  (${pct.padStart(3)}%)`);
}
