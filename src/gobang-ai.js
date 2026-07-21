(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    root.GobangAI = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const DIFFICULTY_SETTINGS = {
        easy: {
            attackWeight: 1,
            defenseWeight: 0.5,
            candidateRatio: 0.72
        },
        medium: {
            attackWeight: 1,
            defenseWeight: 0.62,
            candidateRatio: 0.88
        },
        hard: {
            attackWeight: 1.1,
            defenseWeight: 1.3,
            candidateRatio: 0.97
        }
    };

    function isInBounds(board, row, col) {
        return row >= 0 && row < board.length && col >= 0 && col < board.length;
    }

    function isWinningMove(board, row, col, player) {
        if (board[row][col] !== 0) return false;

        board[row][col] = player;
        const isWin = DIRECTIONS.some(([rowStep, colStep]) => {
            let count = 1;

            for (const direction of [1, -1]) {
                let nextRow = row + rowStep * direction;
                let nextCol = col + colStep * direction;

                while (isInBounds(board, nextRow, nextCol) && board[nextRow][nextCol] === player) {
                    count++;
                    nextRow += rowStep * direction;
                    nextCol += colStep * direction;
                }
            }

            return count >= 5;
        });
        board[row][col] = 0;
        return isWin;
    }

    function evaluatePosition(board, row, col, player) {
        if (board[row][col] !== 0) return -1;

        let score = 0;

        for (const [rowStep, colStep] of DIRECTIONS) {
            let count = 1;
            let openEnds = 0;

            for (const direction of [1, -1]) {
                let nextRow = row + rowStep * direction;
                let nextCol = col + colStep * direction;

                while (isInBounds(board, nextRow, nextCol) && board[nextRow][nextCol] === player) {
                    count++;
                    nextRow += rowStep * direction;
                    nextCol += colStep * direction;
                }

                if (isInBounds(board, nextRow, nextCol) && board[nextRow][nextCol] === 0) {
                    openEnds++;
                }
            }

            if (count >= 5) {
                score += 10000;
            } else if (count === 4 && openEnds >= 1) {
                score += 1000;
            } else if (count === 3) {
                score += openEnds === 2 ? 100 : openEnds === 1 ? 50 : 0;
            } else if (count === 2) {
                score += openEnds === 2 ? 10 : openEnds === 1 ? 5 : 0;
            } else if (count === 1 && openEnds === 2) {
                score += 1;
            }
        }

        return score;
    }

    function getEmptyMoves(board) {
        const moves = [];
        for (let row = 0; row < board.length; row++) {
            for (let col = 0; col < board.length; col++) {
                if (board[row][col] === 0) moves.push({ row, col });
            }
        }
        return moves;
    }

    function pickMove(moves, random) {
        return moves[Math.floor(random() * moves.length)];
    }

    function centerBonus(board, row, col) {
        const center = (board.length - 1) / 2;
        return Math.max(0, board.length - Math.abs(row - center) - Math.abs(col - center)) * 0.2;
    }

    function chooseMove(board, difficulty = 'medium', random = Math.random) {
        const settings = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;
        const aiPlayer = 2;
        const opponent = 1;
        const emptyMoves = getEmptyMoves(board);

        if (emptyMoves.length === 0) return null;

        const winningMoves = emptyMoves.filter(({ row, col }) => isWinningMove(board, row, col, aiPlayer));
        if (winningMoves.length > 0) return pickMove(winningMoves, random);

        const blockingMoves = emptyMoves.filter(({ row, col }) => isWinningMove(board, row, col, opponent));
        if (blockingMoves.length > 0) return pickMove(blockingMoves, random);

        const scoredMoves = emptyMoves.map(({ row, col }) => {
            const attackScore = evaluatePosition(board, row, col, aiPlayer);
            const defenseScore = evaluatePosition(board, row, col, opponent);
            const score = attackScore * settings.attackWeight
                + defenseScore * settings.defenseWeight
                + centerBonus(board, row, col);

            return { row, col, score };
        });

        const bestScore = Math.max(...scoredMoves.map(({ score }) => score));
        const candidates = scoredMoves.filter(({ score }) => score >= bestScore * settings.candidateRatio);
        return pickMove(candidates, random);
    }

    return { chooseMove, evaluatePosition };
}));
