const assert = require('node:assert/strict');
const test = require('node:test');
const { chooseMove, evaluateBoard } = require('../src/gobang-ai.js');

const SIZE = 15;

function boardWith(stones) {
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    for (const [row, col, player] of stones) board[row][col] = player;
    return board;
}

function isOneOf(move, expectedMoves) {
    return expectedMoves.some(([row, col]) => move.row === row && move.col === col);
}

test('all difficulties block a one-ended immediate five-in-a-row in every direction', () => {
    const threats = [
        { stones: [[7, 2, 2], [7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1]], move: [7, 7] },
        { stones: [[2, 7, 2], [3, 7, 1], [4, 7, 1], [5, 7, 1], [6, 7, 1]], move: [7, 7] },
        { stones: [[2, 2, 2], [3, 3, 1], [4, 4, 1], [5, 5, 1], [6, 6, 1]], move: [7, 7] },
        { stones: [[2, 12, 2], [3, 11, 1], [4, 10, 1], [5, 9, 1], [6, 8, 1]], move: [7, 7] }
    ];

    for (const { stones, move: [row, col] } of threats) {
        const board = boardWith(stones);
        const originalBoard = structuredClone(board);

        for (const difficulty of ['easy', 'medium', 'hard']) {
            assert.deepEqual(chooseMove(board, difficulty, () => 0), { row, col }, `${difficulty} should block an immediate loss`);
            assert.deepEqual(board, originalBoard, 'evaluating a move must not modify the board');
        }
    }
});

test('easy defends a three-in-a-row threat instead of pursuing a small attack', () => {
    const board = boardWith([
        [7, 5, 1], [7, 6, 1], [7, 7, 1],
        [10, 6, 2], [10, 7, 2]
    ]);

    const move = chooseMove(board, 'easy', () => 0);
    assert.ok(isOneOf(move, [[7, 4], [7, 8]]));
});

test('medium favors creating its own four over an opposing three-in-a-row threat', () => {
    const board = boardWith([
        [7, 5, 1], [7, 6, 1], [7, 7, 1],
        [10, 5, 2], [10, 6, 2], [10, 7, 2]
    ]);

    const move = chooseMove(board, 'medium', () => 0);
    assert.ok(isOneOf(move, [[10, 4], [10, 8]]));
});

// 注：此处原先断言 hard 应去堵黑的活三。该期望不成立——白在 (10,4)/(10,8) 落子即成
// 活四（两端都能成五），是必胜手；而堵黑的活三只能把活三降为冲四，黑仍能继续进攻。
// 让AI放弃必胜手去防守，是原实现「活四与冲四同分」造成的取舍错误，已修正为选择必胜手。
test('hard prefers a winning open four over blocking an opposing three', () => {
    const board = boardWith([
        [7, 5, 1], [7, 6, 1], [7, 7, 1],
        [10, 5, 2], [10, 6, 2], [10, 7, 2]
    ]);

    const move = chooseMove(board, 'hard', () => 0);
    assert.ok(isOneOf(move, [[10, 4], [10, 8]]));
});

test('all difficulties find the double-four winning move', () => {
    // 白在 (7,7) 落子可同时形成横向冲四(成五点 7,8) 与纵向冲四(成五点 3,7)，黑只能挡一处。
    // 三颗黑子分别堵住 (7,3)、(8,7)、(2,7)，使单方向冲四不足以取胜，(7,7) 成为唯一解。
    const board = boardWith([
        [7, 4, 2], [7, 5, 2], [7, 6, 2],
        [4, 7, 2], [5, 7, 2], [6, 7, 2],
        [7, 3, 1], [8, 7, 1], [2, 7, 1]
    ]);

    for (const difficulty of ['easy', 'medium', 'hard']) {
        const move = chooseMove(board, difficulty, () => 0);
        // 搜索分支会附带 score 字段，硬规则/VCF 分支则只返回坐标，故只比较坐标
        assert.deepEqual({ row: move.row, col: move.col }, { row: 7, col: 7 },
            `${difficulty} 应找到双四杀`);
    }
});

test('chooseMove never mutates the board it is given', () => {
    const scenarios = [
        [],
        [[7, 7, 1]],
        [[7, 5, 1], [7, 6, 1], [7, 7, 1], [10, 5, 2], [10, 6, 2], [10, 7, 2]],
        [[7, 4, 2], [7, 5, 2], [7, 6, 2], [4, 7, 2], [5, 7, 2], [6, 7, 2],
            [7, 3, 1], [8, 7, 1], [2, 7, 1]]
    ];

    for (const stones of scenarios) {
        const board = boardWith(stones);
        const snapshot = structuredClone(board);
        for (const difficulty of ['easy', 'medium', 'hard']) {
            chooseMove(board, difficulty, () => 0.5);
            assert.deepEqual(board, snapshot, '评估与搜索均不得修改传入的棋盘');
        }
    }
});

// negamax 依赖 f(我方) === -f(对手) 才能用符号翻转传递分数。
// 一旦评估函数带上非对称权重（例如只对我方棋型打折），搜索结果就会失真，
// 曾导致中等档反而输给简单档。此处锁死该性质。
test('board evaluation is zero-sum so negamax sign flipping holds', () => {
    const boards = [
        boardWith([]),
        boardWith([[7, 7, 1]]),
        boardWith([[7, 5, 1], [7, 6, 1], [7, 7, 1], [10, 5, 2], [10, 6, 2], [10, 7, 2]]),
        boardWith([[7, 4, 2], [7, 5, 2], [7, 6, 2], [4, 7, 2], [5, 7, 2], [6, 7, 2],
            [7, 3, 1], [8, 7, 1], [2, 7, 1]])
    ];

    for (const board of boards) {
        // 用两者之和判断，避开 assert.strictEqual(0, -0) 在 Object.is 语义下不相等的问题
        assert.equal(evaluateBoard(board, 2) + evaluateBoard(board, 1), 0,
            '从双方视角评估必须互为相反数');
    }
});

test('hard stays within the 800ms thinking delay of the UI', () => {
    // 中后期的密集局面，是搜索最慢的情况
    const board = boardWith([
        [7, 6, 1], [7, 7, 1], [7, 8, 1], [8, 7, 2], [6, 7, 2],
        [8, 8, 2], [6, 6, 2], [9, 9, 1], [5, 5, 1], [7, 9, 2],
        [7, 5, 2], [9, 7, 1], [5, 7, 1], [6, 8, 2], [8, 6, 2]
    ]);

    const started = Date.now();
    chooseMove(board, 'hard', () => 0.5);
    assert.ok(Date.now() - started < 800, '困难档单步耗时应低于UI的思考延时');
});
