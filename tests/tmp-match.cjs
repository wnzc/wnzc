const { chooseMove } = require('../src/gobang-ai.js');
const SIZE = 15;
const newBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
const flip = (b) => b.map((row) => row.map((v) => (v === 0 ? 0 : v === 1 ? 2 : 1)));

const inFive = (b, r, c) => {
    const p = b[r][c];
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
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

// black/white 为难度名；执黑方通过翻转棋盘复用同一 chooseMove
function playMatch(blackLevel, whiteLevel, seed) {
    const board = newBoard();
    let rnd = seed;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };

    for (let turn = 0; turn < SIZE * SIZE; turn++) {
        const isBlack = turn % 2 === 0;
        const level = isBlack ? blackLevel : whiteLevel;
        const player = isBlack ? 1 : 2;

        const view = isBlack ? flip(board) : board;
        const move = chooseMove(view, level, rand);
        if (!move) return 'draw';

        board[move.row][move.col] = player;
        if (inFive(board, move.row, move.col)) return isBlack ? 'black' : 'white';
    }
    return 'draw';
}

function series(blackLevel, whiteLevel, games) {
    const tally = { black: 0, white: 0, draw: 0 };
    for (let i = 0; i < games; i++) {
        tally[playMatch(blackLevel, whiteLevel, i * 7919 + 13)]++;
    }
    return tally;
}

const GAMES = 6;
const pairs = [
    ['easy', 'hard'],
    ['hard', 'easy'],
    ['easy', 'medium'],
    ['medium', 'easy'],
    ['medium', 'hard'],
    ['hard', 'medium']
];

console.log(`自我对局，每组 ${GAMES} 局（执黑有先手优势，故双向各测一组）\n`);
const wins = {};
for (const [b, w] of pairs) {
    const t = series(b, w, GAMES);
    wins[b] = (wins[b] || 0) + t.black;
    wins[w] = (wins[w] || 0) + t.white;
    console.log(`  黑=${b.padEnd(6)} vs 白=${w.padEnd(6)} -> 黑胜 ${t.black} / 白胜 ${t.white} / 和 ${t.draw}`);
}

console.log('\n各难度总胜场（每组各 12 局中的胜场）:');
for (const [k, v] of Object.entries(wins).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(6)} ${v} 胜`);
}
