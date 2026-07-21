const assert = require('node:assert/strict');
const test = require('node:test');
const { chooseMove } = require('../src/gobang-ai.js');

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

test('hard gives priority to blocking an opposing three-in-a-row threat', () => {
    const board = boardWith([
        [7, 5, 1], [7, 6, 1], [7, 7, 1],
        [10, 5, 2], [10, 6, 2], [10, 7, 2]
    ]);

    const move = chooseMove(board, 'hard', () => 0);
    assert.ok(isOneOf(move, [[7, 4], [7, 8]]));
});
