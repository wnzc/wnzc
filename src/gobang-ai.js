(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    root.GobangAI = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

    // 棋型分值。各级别拉开数量级：活四必胜、冲四必应、活三必防，
    // 旧实现把「活四」和「冲四」都算 1000 分，导致AI分不清必胜威胁与可挡威胁。
    const SHAPE = {
        FIVE: 10000000,      // 五连
        OPEN_FOUR: 1000000,  // 活四：两个成五点，无法防守
        FOUR: 100000,        // 冲四：一个成五点，必须应
        OPEN_THREE: 50000,   // 活三：下一手可形成活四
        THREE: 5000,         // 眠三：下一手只能形成冲四
        OPEN_TWO: 500,
        TWO: 100,
        ONE: 10
    };

    const WIN_LEN = 5;
    const HALF = 5;                  // 以落子点为中心向两侧各取 5 格
    const LINE_LEN = HALF * 2 + 1;   // 11 格窗口，足以容纳五连及其两端空间

    // defenseWeight 是「对手棋型的计权系数」：>1 表示更在意对手的威胁（偏防守）。
    // 难度越高越接近中性，把胜负交给搜索而不是权重偏好。
    const DIFFICULTY_SETTINGS = {
        easy: {
            depth: 1,               // 只评估自己这一手，不推演对手应手
            width: 8,
            attackWeight: 0.55,     // 主动进攻的意愿很低，基本只在应付威胁
            defenseWeight: 1.2,     // 偏防守：先堵住看得见的威胁
            randomness: 0.5,        // 容差大，经常走出次优手
            candidateRadius: 1,     // 只看紧邻已有棋子的位置
            maxNodes: 5000,
            useVcf: false,
            vcfDepth: 0
        },
        medium: {
            // 深度 2 是「死区」：只看到对手落子就评估，对手刚获得的收益会给所有分支
            // 带来相同负偏移，区分度被抹平（实测与深度 1 平手、且完败于深度 3）。
            // 因此中等档直接用深度 3：自己 -> 对手 -> 自己。
            depth: 3,
            width: 12,
            attackWeight: 1,        // 搜索档位不使用（走 evaluateBoard）
            defenseWeight: 1,
            randomness: 0.12,
            candidateRadius: 2,
            maxNodes: 20000,
            useVcf: false,
            vcfDepth: 0
        },
        hard: {
            depth: 4,               // 自己 + 对手 + 自己 + 对手
            width: 10,
            attackWeight: 1,
            defenseWeight: 1,
            randomness: 0,
            candidateRadius: 2,
            maxNodes: 60000,
            useVcf: true,           // 连续冲四取胜搜索
            vcfDepth: 3
        }
    };

    const AI_PLAYER = 2;
    const OPPONENT = 1;

    // 复用缓冲，避免热路径上反复分配
    const LINE_BUFFER = new Int8Array(LINE_LEN);

    // ------------------------------------------------------------------
    // 线的构建：0=空, 1=己方, 2=对方或边界
    // ------------------------------------------------------------------

    function buildLine(board, row, col, dr, dc, player) {
        const size = board.length;
        const line = LINE_BUFFER;
        for (let i = -HALF; i <= HALF; i++) {
            const idx = HALF + i;
            if (i === 0) {
                line[idx] = 1;      // 假设己方落子于此
                continue;
            }
            const r = row + dr * i;
            const c = col + dc * i;
            if (r < 0 || r >= size || c < 0 || c >= size) {
                line[idx] = 2;      // 越界视作墙
                continue;
            }
            const v = board[r][c];
            line[idx] = v === 0 ? 0 : (v === player ? 1 : 2);
        }
        return line;
    }

    // ------------------------------------------------------------------
    // 基础模式识别（滑动窗口，O(LINE_LEN * WIN_LEN)）
    // ------------------------------------------------------------------

    function hasFive(line) {
        for (let s = 0; s + WIN_LEN <= LINE_LEN; s++) {
            let ok = true;
            for (let k = 0; k < WIN_LEN; k++) {
                if (line[s + k] !== 1) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    // 统计「再落一子即可成五」的空位数量（去重后）
    function fivePoints(line) {
        const marks = new Uint8Array(LINE_LEN);
        let count = 0;
        for (let s = 0; s + WIN_LEN <= LINE_LEN; s++) {
            let ones = 0;
            let zeroIdx = -1;
            let blocked = false;
            for (let k = 0; k < WIN_LEN; k++) {
                const v = line[s + k];
                if (v === 1) {
                    ones++;
                } else if (v === 0) {
                    if (zeroIdx >= 0) { blocked = true; break; }   // 窗口内两个空位，填一子不成五
                    zeroIdx = s + k;
                } else {
                    blocked = true;
                    break;
                }
            }
            if (blocked || zeroIdx < 0) continue;
            if (ones === WIN_LEN - 1 && !marks[zeroIdx]) {
                marks[zeroIdx] = 1;
                count++;
            }
        }
        return count;
    }

    // 低阶棋型：中心连子数 + 开放端（二、一级别无需完整搜索，避免不必要的开销）
    function classifyMinor(line) {
        let count = 1;
        let openEnds = 0;

        for (let i = HALF + 1; i < LINE_LEN; i++) {
            if (line[i] === 1) count++;
            else { if (line[i] === 0) openEnds++; break; }
        }
        for (let i = HALF - 1; i >= 0; i--) {
            if (line[i] === 1) count++;
            else { if (line[i] === 0) openEnds++; break; }
        }

        if (count >= 2 && openEnds === 2) return SHAPE.OPEN_TWO;
        if (count >= 2) return SHAPE.TWO;
        return SHAPE.ONE;
    }

    // 判定一条线的棋型。line[HALF] 为刚落下的己方子。
    function classifyLine(line) {
        let mine = 0;
        for (let i = 0; i < LINE_LEN; i++) {
            if (line[i] === 1) mine++;
        }

        // 冲四需要 4 子、活四需要 4 子、成五需要 5 连
        if (mine >= WIN_LEN - 1) {
            if (hasFive(line)) return SHAPE.FIVE;
            const fp = fivePoints(line);
            if (fp >= 2) return SHAPE.OPEN_FOUR;   // 两端都能成五，无法防守
            if (fp === 1) return SHAPE.FOUR;       // 只有一个成五点，必须应
        }

        // 活三 = 再落一子可形成活四；眠三 = 再落一子只能形成冲四。
        // 逐层加深即可自然覆盖跳型（X_XX / XX_X），无需单独维护跳型模式表。
        if (mine >= 3) {
            let canThree = false;
            for (let i = 0; i < LINE_LEN; i++) {
                if (line[i] !== 0) continue;
                line[i] = 1;
                const fp = fivePoints(line);
                line[i] = 0;
                if (fp >= 2) return SHAPE.OPEN_THREE;
                if (fp === 1) canThree = true;
            }
            if (canThree) return SHAPE.THREE;
        }

        return classifyMinor(line);
    }

    // ------------------------------------------------------------------
    // 落子点评估
    // ------------------------------------------------------------------

    // 假设 player 落在 (row,col)，四个方向的棋型价值之和，并叠加组合威胁加成。
    // 单方向分值无法体现「双活三」「四三」这类必胜组合，故单独计权。
    function pointScore(board, row, col, player) {
        let score = 0;
        let openFour = 0;
        let four = 0;
        let openThree = 0;

        for (const [dr, dc] of DIRECTIONS) {
            const shape = classifyLine(buildLine(board, row, col, dr, dc, player));
            score += shape;
            if (shape === SHAPE.OPEN_FOUR) openFour++;
            else if (shape === SHAPE.FOUR) four++;
            else if (shape === SHAPE.OPEN_THREE) openThree++;
        }

        if (openFour >= 2 || (openFour >= 1 && four >= 1) || four >= 2) {
            score += SHAPE.FIVE / 2;                  // 双四 / 四四：必胜
        } else if (openFour >= 1) {
            score += SHAPE.OPEN_FOUR;                 // 活四：必胜
        } else if (openThree >= 2 || (openThree >= 1 && four >= 1)) {
            score += SHAPE.OPEN_FOUR / 2;             // 双活三 / 四三：必胜
        }

        return score;
    }

    // 仅用于走法排序（影响剪枝效率，不影响最终结果，alpha-beta 保证最优）。
    // 这里的 defense 项只是「对手在此的潜在价值」，权重刻意压低，
    // 避免对手已有活四时把「对手下这里就赢」误算成「我抢这里的收益」。
    function orderScore(board, row, col, turn, foe) {
        return pointScore(board, row, col, turn)
            + pointScore(board, row, col, foe) * 0.5
            + centerBonus(board, row, col);
    }

    // ------------------------------------------------------------------
    // 整盘评估：统计双方各自的棋型总量，取加权差。
    // 与「单点抢点启发式」不同，这里只统计棋盘上真实存在的棋型，
    // 因此对手的活四会被如实记为对手的收益，而不是我方抢占的收益。
    // ------------------------------------------------------------------
    // 注意：这里刻意不叠加「组合威胁」加成。
    // 实测表明，在搜索的评估函数中加入「双活三/四三额外加分」这类阶跃项，
    // 会在搜索地平线处引起剧烈波动，反而使中等档输给简单档（胜率 20% vs 关闭后的 80%）。
    // 棋型分值本身已拉开活四/冲四/活三的差距，组合威胁交给搜索深度去发现。
    function tallySide(board, player) {
        const size = board.length;
        let total = 0;

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (board[r][c] !== player) continue;
                for (const [dr, dc] of DIRECTIONS) {
                    // 只从连子的首端统计，避免同一条连子被每个棋子重复计入
                    const pr = r - dr;
                    const pc = c - dc;
                    if (isInBounds(board, pr, pc) && board[pr][pc] === player) continue;

                    total += classifyLine(buildLine(board, r, c, dr, dc, player));
                }
            }
        }

        return total;
    }

    // 搜索内部使用的评估：必须保持零和（f(我方) === -f(对手)），
    // 否则 negamax 的符号翻转前提不成立，搜索结果会失真。
    // 因此这里不乘 defenseWeight，双方棋型等权相减。
    function evaluateBoard(board, turn) {
        const foe = turn === AI_PLAYER ? OPPONENT : AI_PLAYER;
        return tallySide(board, turn) - tallySide(board, foe);
    }

    // 根节点专用的评估，仅用于不展开搜索的档位（depth <= 1）。
    // 这些档位没有对手应手的推演，靠 attackWeight / defenseWeight 体现倾向：
    // attackWeight < 1 表示不擅长主动进攻，只会应对眼前的威胁。
    function evaluateRoot(board, turn, settings) {
        const foe = turn === AI_PLAYER ? OPPONENT : AI_PLAYER;
        return tallySide(board, turn) * settings.attackWeight
            - tallySide(board, foe) * settings.defenseWeight;
    }

    // ------------------------------------------------------------------
    // 辅助查询
    // ------------------------------------------------------------------

    function isInBounds(board, row, col) {
        return row >= 0 && row < board.length && col >= 0 && col < board.length;
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

    // 候选点限制在已有棋子 radius 格邻域内，避免搜索整块空棋盘
    function getCandidates(board, radius) {
        const size = board.length;
        const seen = new Set();
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (board[r][c] === 0) continue;
                for (let dr = -radius; dr <= radius; dr++) {
                    for (let dc = -radius; dc <= radius; dc++) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (!isInBounds(board, nr, nc)) continue;
                        if (board[nr][nc] !== 0) continue;
                        seen.add(nr * size + nc);
                    }
                }
            }
        }
        if (seen.size === 0) {
            const mid = (size - 1) >> 1;
            return [{ row: mid, col: mid }];
        }
        const moves = [];
        for (const key of seen) {
            moves.push({ row: (key / size) | 0, col: key % size });
        }
        return moves;
    }

    function isFive(board, row, col, player) {
        for (const [dr, dc] of DIRECTIONS) {
            if (hasFive(buildLine(board, row, col, dr, dc, player))) return true;
        }
        return false;
    }

    function isWinningMove(board, row, col, player) {
        if (board[row][col] !== 0) return false;
        board[row][col] = player;
        const win = isFive(board, row, col, player);
        board[row][col] = 0;
        return win;
    }

    function centerBonus(board, row, col) {
        const center = (board.length - 1) / 2;
        return Math.max(0, board.length - Math.abs(row - center) - Math.abs(col - center)) * 0.2;
    }

    // ------------------------------------------------------------------
    // 搜索：negamax + alpha-beta
    // ------------------------------------------------------------------

    // 走法排序：先算最有威胁的点，剪枝效率提升一个量级
    function orderedMoves(board, turn, settings) {
        const foe = turn === AI_PLAYER ? OPPONENT : AI_PLAYER;
        const moves = getCandidates(board, settings.candidateRadius);
        const scored = moves.map(({ row, col }) => ({
            row,
            col,
            score: orderScore(board, row, col, turn, foe)
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, settings.width);
    }

    // negamax + alpha-beta，返回「当前行动方」视角的局面分
    function negamax(board, depth, alpha, beta, turn, settings, ctx) {
        ctx.nodes++;
        if (ctx.nodes >= ctx.maxNodes) return evaluateBoard(board, turn);

        const foe = turn === AI_PLAYER ? OPPONENT : AI_PLAYER;
        const moves = orderedMoves(board, turn, settings);
        if (moves.length === 0) return 0;

        let best = -Infinity;
        for (const move of moves) {
            board[move.row][move.col] = turn;

            let value;
            if (isFive(board, move.row, move.col, turn)) {
                value = SHAPE.FIVE + depth;                      // 越早取胜越好
            } else if (depth <= 1) {
                value = evaluateBoard(board, turn);               // 叶节点：整盘评估
            } else {
                value = -negamax(board, depth - 1, -beta, -alpha, foe, settings, ctx);
            }

            board[move.row][move.col] = 0;

            if (value > best) best = value;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;                            // alpha-beta 剪枝
        }
        return best;
    }

    // ------------------------------------------------------------------
    // VCF：连续冲四取胜（Victory by Continuous Four）
    // 只搜索「冲四/活四」这类对手必须应的走法，分支因子极小。
    // ------------------------------------------------------------------

    // 所有能形成四（含活四）的进攻点
    function getFourMoves(board, player) {
        const moves = [];
        for (const { row, col } of getCandidates(board, 2)) {
            for (const [dr, dc] of DIRECTIONS) {
                if (fivePoints(buildLine(board, row, col, dr, dc, player)) >= 1) {
                    moves.push({ row, col });
                    break;
                }
            }
        }
        return moves;
    }

    // 进攻方所有「再落一子即成五」的点，即防守方必须封堵的位置
    function getVcfReplies(board, attacker) {
        const replies = [];
        for (const { row, col } of getCandidates(board, 2)) {
            for (const [dr, dc] of DIRECTIONS) {
                if (hasFive(buildLine(board, row, col, dr, dc, attacker))) {
                    replies.push({ row, col });
                    break;
                }
            }
        }
        return replies;
    }

    // 该方是否存在一步成五的点（用于判断防守方能否反杀）
    function hasImmediateWin(board, player) {
        for (const { row, col } of getCandidates(board, 2)) {
            if (isWinningMove(board, row, col, player)) return true;
        }
        return false;
    }

    function findVcf(board, player, depth, ctx) {
        if (depth <= 0) return null;

        const foe = player === AI_PLAYER ? OPPONENT : AI_PLAYER;
        const attacks = getFourMoves(board, player);

        for (const move of attacks) {
            if (ctx.nodes >= ctx.maxNodes) return null;
            ctx.nodes++;

            board[move.row][move.col] = player;
            let forced = false;

            if (isFive(board, move.row, move.col, player)) {
                forced = true;
            } else {
                const replies = getVcfReplies(board, player);
                // 对手若能直接成五，则本次冲四无效（会被反杀）。
                // 只遍历候选点并短路返回，避免每个 VCF 节点都扫描全部 225 个空位。
                const counterWin = hasImmediateWin(board, foe);
                if (!counterWin && replies.length > 0) {
                    forced = true;
                    for (const reply of replies) {
                        board[reply.row][reply.col] = foe;
                        const sub = findVcf(board, player, depth - 1, ctx);
                        board[reply.row][reply.col] = 0;
                        if (!sub) { forced = false; break; }
                    }
                }
            }

            board[move.row][move.col] = 0;

            if (forced) return { row: move.row, col: move.col };
        }
        return null;
    }

    // ------------------------------------------------------------------
    // 对外接口
    // ------------------------------------------------------------------

    function pickMove(moves, random) {
        if (!moves || moves.length === 0) return null;
        // 夹紧下标：random() 可能返回 0/1 边界值，直接取模在 random()>1 时会越界
        const idx = Math.min(moves.length - 1, Math.max(0, Math.floor(random() * moves.length)));
        return moves[idx];
    }

    function chooseMove(board, difficulty = 'medium', random = Math.random) {
        const settings = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;
        const emptyMoves = getEmptyMoves(board);
        if (emptyMoves.length === 0) return null;

        const ctx = { nodes: 0, maxNodes: settings.maxNodes };

        // 1. 己方能一步取胜
        const winningMoves = emptyMoves.filter(({ row, col }) => isWinningMove(board, row, col, AI_PLAYER));
        if (winningMoves.length > 0) return pickMove(winningMoves, random);

        // 2. 对手下一步成五，必须堵
        const blockingMoves = emptyMoves.filter(({ row, col }) => isWinningMove(board, row, col, OPPONENT));
        if (blockingMoves.length > 0) return pickMove(blockingMoves, random);

        // 3. 连续冲四取胜（仅困难档）
        if (settings.useVcf) {
            const vcf = findVcf(board, AI_PLAYER, settings.vcfDepth, ctx);
            if (vcf) return vcf;
        }

        // 4. 搜索
        const candidates = orderedMoves(board, AI_PLAYER, settings);
        const results = [];
        let bestScore = -Infinity;

        for (const move of candidates) {
            board[move.row][move.col] = AI_PLAYER;

            let score;
            if (isFive(board, move.row, move.col, AI_PLAYER)) {
                score = SHAPE.FIVE;
            } else if (settings.depth <= 1) {
                score = evaluateRoot(board, AI_PLAYER, settings);
            } else {
                score = -negamax(board, settings.depth - 1, -Infinity, Infinity, OPPONENT, settings, ctx);
            }

            board[move.row][move.col] = 0;

            results.push({ row: move.row, col: move.col, score });
            if (score > bestScore) bestScore = score;
        }

        if (results.length === 0) return null;

        // 5. 按难度的随机容差挑选：容差越大越容易走出非最优手
        const tolerance = Math.abs(bestScore) * settings.randomness;
        const pool = results.filter((r) => r.score >= bestScore - tolerance);
        return pickMove(pool, random);
    }

    // 保留对外兼容：该点对 player 的棋型价值
    function evaluatePosition(board, row, col, player) {
        if (board[row][col] !== 0) return -1;
        return pointScore(board, row, col, player);
    }

    return { chooseMove, evaluatePosition, evaluateBoard };
}));
