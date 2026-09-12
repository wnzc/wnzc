const { chooseMove } = require('../src/gobang-ai.js');
const SIZE = 15;
const B = (stones) => {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (const [r, c, p] of stones) b[r][c] = p;
  return b;
};
const inFive = (b, r, c) => {
  const p = b[r][c];
  const D = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of D) {
    let n = 1;
    for (const s of [1, -1]) {
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i * s, nc = c + dc * i * s;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || b[nr][nc] !== p) break;
        n++;
      }
    }
    if (n >= 5) return true;
  }
  return false;
};

// 局面1: 黑活三 + 白活三，轮到白
const s1 = [[7, 5, 1], [7, 6, 1], [7, 7, 1], [10, 5, 2], [10, 6, 2], [10, 7, 2]];
console.log('局面1：黑活三(7,5..7) / 白活三(10,5..7)，轮到白');
for (const d of ['easy', 'medium', 'hard']) {
  const m = chooseMove(B(s1), d, () => 0);
  console.log(`  ${d.padEnd(6)} -> (${m.row},${m.col})`);
}

console.log('\n  若白下(10,4)造活四，黑无论堵哪端白都能成五:');
for (const [br, bc] of [[10, 3], [10, 8]]) {
  const b = B([...s1, [10, 4, 2], [br, bc, 1]]);
  const wr = 10, wc = br === 10 && bc === 3 ? 8 : 3;
  b[10][wc] = 2;
  console.log(`    黑堵(${br},${bc}) -> 白下(10,${wc}) 成五: ${inFive(b, 10, wc)}`);
}
console.log('  若白按旧测试期望去堵(7,8)，黑下(7,4)只是冲四（白可再堵(7,3)），白未获胜');

// 局面2: 一子双四杀
const s2 = [[7, 4, 2], [7, 5, 2], [7, 6, 2], [4, 7, 2], [5, 7, 2], [6, 7, 2], [7, 3, 1], [8, 7, 1]];
console.log('\n局面2：白(7,4)(7,5)(7,6)横 + 白(4,7)(5,7)(6,7)竖；黑(7,3)(8,7)堵住两端');
console.log('  白下(7,7)应形成横向冲四(成五点(7,8)) + 纵向冲四(成五点(3,7)) = 双四必胜');
for (const d of ['easy', 'medium', 'hard']) {
  const m = chooseMove(B(s2), d, () => 0);
  const ok = m.row === 7 && m.col === 7;
  console.log(`  ${d.padEnd(6)} -> (${m.row},${m.col})  ${ok ? '找到双四杀' : '未找到'}`);
}
{
  const b = B([...s2, [7, 7, 2]]);
  console.log('  验证白(7,7)后 黑堵(7,8) -> 白(3,7)成五:', (b[7][8] = 1, b[3][7] = 2, inFive(b, 3, 7)));
  const b2 = B([...s2, [7, 7, 2]]);
  console.log('  验证白(7,7)后 黑堵(3,7) -> 白(7,8)成五:', (b2[3][7] = 1, b2[7][8] = 2, inFive(b2, 7, 8)));
}

// 性能
console.log('\n性能（各难度 20 手，单步最慢）:');
for (const d of ['easy', 'medium', 'hard']) {
  let b = B([]); let worst = 0; const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    const who = i % 2 === 0 ? 1 : 2;
    const s = Date.now();
    const m = chooseMove(b, d, () => 0.5);
    worst = Math.max(worst, Date.now() - s);
    if (!m) break;
    b[m.row][m.col] = who;
  }
  console.log(`  ${d.padEnd(6)} 总 ${String(Date.now() - t0).padStart(5)}ms  单步最慢 ${String(worst).padStart(4)}ms`);
}
