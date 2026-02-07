// ==========================================
// 0. MCTS Configuration & Cache
// ==========================================

// Configure ONNX Runtime WASM paths
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";

// Session Cache to avoid reloading models
const sessionCache = {
    'ttt': null,
    'c4': null,
    'gomoku': null
};

// Config per game
const GAME_CONFIG = {
    'ttt': { sims: 200, c_puct: 1.0 },    // TTT is simple, fast is better
    'c4': { sims: 800, c_puct: 1.4 },     // C4 needs decent depth
    'gomoku': { sims: 1600, c_puct: 1.4 } // Gomoku 9x9 needs more search
};

let currentConfig = { numSimulations: 400, c_puct: 1.4 };

// ==========================================
// 1. Game Logic Engines (核心规则)
// ==========================================

class AbstractGame {
    getInitialState() { throw new Error("Not implemented"); }
    getNextState(state, action, toPlay) { throw new Error("Not implemented"); }
    getValidMoves(state) { throw new Error("Not implemented"); }
    checkWin(state) { throw new Error("Not implemented"); }
    encodeState(state, toPlay) { throw new Error("Not implemented"); }
    // Helper: Extract current board (last plane) from state history stack
    _getBoard(state, stepIndex) { throw new Error("Not implemented"); }
}

class TicTacToe extends AbstractGame {
    constructor() {
        super();
        this.boardSize = 9;
        this.actionSpace = 9;
        this.historyStep = 3;
        this.row = 3; this.col = 3;
    }

    getInitialState() {
        // Shape: [historyStep, 3, 3] flattened -> historyStep * 9
        return new Float32Array(this.historyStep * 9).fill(0);
    }

    _getBoard(state, stepIndex) {
        const offset = stepIndex * 9;
        return state.subarray(offset, offset + 9);
    }

    getNextState(state, action, toPlay) {
        const newState = new Float32Array(state.length);
        const bs = 9;
        // Shift history: 0<-1, 1<-2
        for (let i = 0; i < this.historyStep - 1; i++) {
            newState.set(state.subarray((i + 1) * bs, (i + 2) * bs), i * bs);
        }
        // Copy last to new current
        const lastStart = (this.historyStep - 1) * bs;
        newState.set(state.subarray(lastStart, lastStart + bs), lastStart);
        // Apply move
        newState[lastStart + action] = toPlay;
        return newState;
    }

    getValidMoves(state) {
        const moves = [];
        const board = this._getBoard(state, this.historyStep - 1);
        for (let i = 0; i < 9; i++) if (board[i] === 0) moves.push(i);
        return moves;
    }

    checkWin(state) {
        const board = this._getBoard(state, this.historyStep - 1);
        const lines = [
            [0,1,2],[3,4,5],[6,7,8], // Rows
            [0,3,6],[1,4,7],[2,5,8], // Cols
            [0,4,8],[2,4,6]          // Diags
        ];
        for (const line of lines) {
            const sum = board[line[0]] + board[line[1]] + board[line[2]];
            if (sum === 3) return 1;
            if (sum === -3) return -1;
        }
        for(let i=0; i<9; i++) if(board[i]===0) return null; // Not full
        return 0; // Draw
    }

    encodeState(state, toPlay) {
        // [1, 2*hist+1, 3, 3]
        const numPlanes = 2 * this.historyStep + 1;
        const input = new Float32Array(numPlanes * 9);
        for (let i = 0; i < this.historyStep; i++) {
            const board = this._getBoard(state, i);
            const p1 = (2 * i) * 9;
            const p2 = (2 * i + 1) * 9;
            for (let j = 0; j < 9; j++) {
                if (board[j] === toPlay) input[p1 + j] = 1;
                else if (board[j] === -toPlay) input[p2 + j] = 1;
            }
        }
        const c = (2 * this.historyStep) * 9;
        const val = toPlay > 0 ? 1 : 0;
        for (let j = 0; j < 9; j++) input[c + j] = val;
        return input;
    }
}

class Connect4 extends AbstractGame {
    constructor() {
        super();
        this.rows = 6; this.cols = 7;
        this.boardSize = 42;
        this.actionSpace = 7;
        this.historyStep = 3;
    }

    getInitialState() { return new Float32Array(this.historyStep * 42).fill(0); }
    
    _getBoard(state, stepIndex) {
        const offset = stepIndex * 42;
        return state.subarray(offset, offset + 42);
    }

    getNextState(state, action, toPlay) {
        const newState = new Float32Array(state.length);
        const bs = 42;
        for (let i = 0; i < this.historyStep - 1; i++) {
            newState.set(state.subarray((i + 1) * bs, (i + 2) * bs), i * bs);
        }
        const lastStart = (this.historyStep - 1) * bs;
        newState.set(state.subarray(lastStart, lastStart + bs), lastStart);
        
        // Apply gravity
        for (let r = this.rows - 1; r >= 0; r--) {
            const idx = lastStart + r * this.cols + action;
            if (newState[idx] === 0) {
                newState[idx] = toPlay;
                break;
            }
        }
        return newState;
    }

    getValidMoves(state) {
        const moves = [];
        const board = this._getBoard(state, this.historyStep - 1);
        for (let c = 0; c < this.cols; c++) {
            if (board[c] === 0) moves.push(c); // Check top row
        }
        return moves;
    }

    checkWin(state) {
        const board = this._getBoard(state, this.historyStep - 1);
        const get = (r, c) => board[r * 7 + c];
        
        // Directions: Horizontal, Vertical, Diag1, Diag2
        const check = (r, c, dr, dc) => {
            const val = get(r, c);
            if (val === 0) return false;
            for (let k = 1; k < 4; k++) {
                const nr = r + dr * k, nc = c + dc * k;
                if (nr < 0 || nr >= 6 || nc < 0 || nc >= 7 || get(nr, nc) !== val) return false;
            }
            return true;
        };

        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                if (c <= 3 && check(r, c, 0, 1)) return get(r, c);
                if (r <= 2 && check(r, c, 1, 0)) return get(r, c);
                if (r <= 2 && c <= 3 && check(r, c, 1, 1)) return get(r, c);
                if (r <= 2 && c >= 3 && check(r, c, 1, -1)) return get(r, c);
            }
        }
        for(let i=0; i<42; i++) if(board[i]===0) return null;
        return 0;
    }

    encodeState(state, toPlay) {
        const bs = 42;
        const numPlanes = 2 * this.historyStep + 1;
        const input = new Float32Array(numPlanes * bs);
        for (let i = 0; i < this.historyStep; i++) {
            const board = this._getBoard(state, i);
            const p1 = (2 * i) * bs;
            const p2 = (2 * i + 1) * bs;
            for (let j = 0; j < bs; j++) {
                if (board[j] === toPlay) input[p1 + j] = 1;
                else if (board[j] === -toPlay) input[p2 + j] = 1;
            }
        }
        const c = (2 * this.historyStep) * bs;
        const val = toPlay > 0 ? 1 : 0;
        for (let j = 0; j < bs; j++) input[c + j] = val;
        return input;
    }
}

class Gomoku extends AbstractGame {
    constructor() {
        super();
        this.size = 9;
        this.boardSize = 81;
        this.actionSpace = 81;
        this.historyStep = 4;
    }

    getInitialState() { return new Float32Array(this.historyStep * 81).fill(0); }
    _getBoard(state, stepIndex) {
        const offset = stepIndex * 81;
        return state.subarray(offset, offset + 81);
    }

    getNextState(state, action, toPlay) {
        const newState = new Float32Array(state.length);
        const bs = 81;
        for (let i = 0; i < this.historyStep - 1; i++) {
            newState.set(state.subarray((i + 1) * bs, (i + 2) * bs), i * bs);
        }
        const last = (this.historyStep - 1) * bs;
        newState.set(state.subarray(last, last + bs), last);
        newState[last + action] = toPlay;
        return newState;
    }

    getValidMoves(state) {
        const moves = [];
        const board = this._getBoard(state, this.historyStep - 1);
        for (let i = 0; i < 81; i++) if (board[i] === 0) moves.push(i);
        return moves;
    }

    checkWin(state) {
        const board = this._getBoard(state, this.historyStep - 1);
        const S = 9;
        const get = (r, c) => (r < 0 || r >= S || c < 0 || c >= S) ? 0 : board[r * S + c];
        
        for (let r = 0; r < S; r++) {
            for (let c = 0; c < S; c++) {
                const p = get(r, c);
                if (p === 0) continue;
                const dirs = [[0,1], [1,1], [1,0], [1,-1]];
                for (const [dr, dc] of dirs) {
                    let match = true;
                    for (let k = 1; k < 5; k++) if (get(r + dr * k, c + dc * k) !== p) { match = false; break; }
                    if (match) return p;
                }
            }
        }
        for(let i=0; i<81; i++) if(board[i]===0) return null;
        return 0;
    }

    encodeState(state, toPlay) {
        const bs = 81;
        const numPlanes = 2 * this.historyStep + 1;
        const input = new Float32Array(numPlanes * bs);
        for (let i = 0; i < this.historyStep; i++) {
            const board = this._getBoard(state, i);
            const p1 = (2 * i) * bs;
            const p2 = (2 * i + 1) * bs;
            for (let j = 0; j < bs; j++) {
                if (board[j] === toPlay) input[p1 + j] = 1;
                else if (board[j] === -toPlay) input[p2 + j] = 1;
            }
        }
        const c = (2 * this.historyStep) * bs;
        const val = toPlay > 0 ? 1 : 0;
        for (let j = 0; j < bs; j++) input[c + j] = val;
        return input;
    }
}

// ==========================================
// 2. MCTS Engine (核心算法)
// ==========================================

class Node {
    constructor(state, toPlay, prior = 0, parent = null, actionTaken = null) {
        this.state = state;
        this.toPlay = toPlay;
        this.prior = prior;
        this.parent = parent;
        this.actionTaken = actionTaken;
        this.children = [];
        this.v = 0;
        this.n = 0;
    }
    isExpanded() { return this.children.length > 0; }
    update(value) { this.v += value; this.n += 1; }
}

class MCTS {
    constructor(game, session, args) {
        this.game = game;
        this.session = session;
        this.args = args;
    }

    select(node) {
        let bestScore = -Infinity;
        let bestChild = null;
        for (const child of node.children) {
            const q = child.n > 0 ? -child.v / child.n : 0;
            const u = this.args.c_puct * child.prior * (Math.sqrt(node.n) / (1 + child.n));
            const score = q + u;
            if (score > bestScore) { bestScore = score; bestChild = child; }
        }
        return bestChild;
    }

    async expand(node) {
        const encoded = this.game.encodeState(node.state, node.toPlay);
        
        // Define Input Shapes
        let dims;
        if (this.game instanceof TicTacToe) dims = [1, 7, 3, 3];
        else if (this.game instanceof Connect4) dims = [1, 7, 6, 7];
        else if (this.game instanceof Gomoku) dims = [1, 9, 9, 9];

        const tensor = new ort.Tensor('float32', encoded, dims);
        const results = await this.session.run({ input: tensor });
        
        const policyLogits = results.policy.data;
        const value = results.value.data[0]; // [-1, 1]

        // Mask & Softmax
        const legalMoves = this.game.getValidMoves(node.state);
        let maxLogit = -Infinity;
        for (const move of legalMoves) if (policyLogits[move] > maxLogit) maxLogit = policyLogits[move];

        let sumExp = 0;
        const probs = new Float32Array(this.game.actionSpace).fill(0);
        for (const move of legalMoves) {
            probs[move] = Math.exp(policyLogits[move] - maxLogit);
            sumExp += probs[move];
        }

        for (const move of legalMoves) {
            const prob = probs[move] / sumExp;
            if (prob > 0) {
                const nextState = this.game.getNextState(node.state, move, node.toPlay);
                // Child's toPlay is opposite of current node
                const child = new Node(nextState, -node.toPlay, prob, node, move);
                node.children.push(child);
            }
        }
        return value;
    }

    backpropagate(node, value) {
        while (node) {
            node.update(value);
            value = -value; // Flip value for parent
            node = node.parent;
        }
    }

    select(node) {
        let bestScore = -Infinity;
        let bestChild = null;
        for (const child of node.children) {
            const q = child.n > 0 ? -child.v / child.n : 0;
            // Use dynamic c_puct from args (currentConfig)
            const u = this.args.c_puct * child.prior * (Math.sqrt(node.n) / (1 + child.n));
            const score = q + u;
            if (score > bestScore) { bestScore = score; bestChild = child; }
        }
        return bestChild;
    }
            
            // 1. Select
            while (node.isExpanded()) node = this.select(node);
            
            // 2. Expand & Evaluate
            let value;
            const winner = this.game.checkWin(node.state);
            if (winner !== null) {
                // If winner is toPlay, value is 1. If winner is opponent, value is -1.
                // Draw is 0.
                if (winner === 0) value = 0;
                else value = (winner === node.toPlay) ? 1 : -1;
            } else {
                value = await this.expand(node);
            }

            // 3. Backpropagate
            this.backpropagate(node, value);

            // Yield to UI every 50 iterations
            if (i % 50 === 0) {
                if (this.args.onProgress) this.args.onProgress(i, this.args.numSimulations);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // Final progress update
        if (this.args.onProgress) this.args.onProgress(this.args.numSimulations, this.args.numSimulations);

        // Return visit counts
        const counts = new Float32Array(this.game.actionSpace).fill(0);
        let sumCounts = 0;
        for (const child of root.children) {
            counts[child.actionTaken] = child.n;
            sumCounts += child.n;
        }

        // Winrate from root perspective
        const winRate = (root.v / root.n + 1) / 2;
        return { actionCounts: counts, totalCounts: sumCounts, winRate: winRate, root: root };
    }
}

// ==========================================
// 3. UI & Interaction Logic
// ==========================================

let gameEngine = null; // TicTacToe / Connect4 / Gomoku instance
let currentSession = null; // ONNX Session
let gameState = null; // Current big state (Float32Array with history)
let playerSide = 'first'; // 'first' (1) or 'second' (-1)
let currentToPlay = 1; // 1 (Black/First) or -1 (White/Second)
let isAiThinking = false;
let activeGameType = 'ttt';
let historyStack = []; // For Undo

// DOM Elements
const uiBoardTTT = document.getElementById('ttt-board');
const uiBoardC4 = document.getElementById('c4-board');
const uiBoardGomoku = document.getElementById('gomoku-board');
const uiLoading = document.getElementById('loading-overlay');
const uiStatus = document.getElementById('status-bar');
const uiWinRateBar = document.getElementById('winrate-bar');
const uiWinRateText = document.getElementById('winrate-text');
const uiInferenceTime = document.getElementById('inference-time');

// Init
window.onload = () => switchGame('ttt');

async function switchGame(type) {
    activeGameType = type;
    
    // UI Tabs Styling
    ['ttt', 'c4', 'gomoku'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (t === type) el.className = "px-6 py-2 rounded-lg text-sm font-medium transition-all bg-gray-900 text-white shadow-md";
        else el.className = "px-6 py-2 rounded-lg text-sm font-medium transition-all text-gray-500 hover:text-gray-900";
    });

    // Show/Hide Boards
    uiBoardTTT.classList.add('hidden');
    uiBoardC4.classList.add('hidden');
    uiBoardGomoku.classList.add('hidden');
    
    if (type === 'ttt') {
        gameEngine = new TicTacToe();
        uiBoardTTT.classList.remove('hidden');
    } else if (type === 'c4') {
        gameEngine = new Connect4();
        uiBoardC4.classList.remove('hidden');
        initC4UI();
    } else if (type === 'gomoku') {
        gameEngine = new Gomoku();
        uiBoardGomoku.classList.remove('hidden');
    }

    // Load Model or Use Cache
    currentConfig.numSimulations = GAME_CONFIG[type].sims;
    currentConfig.c_puct = GAME_CONFIG[type].c_puct;

    if (sessionCache[type]) {
        console.log(`Using cached session for ${type}`);
        currentSession = sessionCache[type];
        resetGame();
        return;
    }

    uiLoading.classList.remove('hidden');
    uiStatus.innerText = "正在加载模型...";
    
    let modelFile = `${type === 'ttt' ? 'tictactoe' : (type === 'c4' ? 'connect4' : 'gomoku')}.onnx`;
    
    try {
        // Explicitly fetch first to check status and provide better diagnostics
        const response = await fetch(modelFile);
        if (!response.ok) {
            throw new Error(`获取失败: ${response.status} ${response.statusText} for ${modelFile}`);
        }
        
        const contentType = response.headers.get('content-type');
        console.log(`Loading ${modelFile} (Size: ${response.headers.get('content-length')} bytes, Type: ${contentType})`);
        
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 1000) {
             console.warn("警告：模型文件过小。这可能是 Git LFS 指针或 HTML 错误页面。");
        }

        currentSession = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
        sessionCache[type] = currentSession; // Cache it!

        console.log("Model loaded successfully:", modelFile);
        resetGame();
    } catch (e) {
        console.error(e);
        const msg = `加载失败 ${modelFile}\n错误信息: ${e.message}\n\n故障排除:\n1. 如果托管在子文件夹中，请检查 URL 是否以 '/' 结尾。\n2. 确保 .onnx 文件已提交 (未被忽略)。\n3. 查看控制台获取详细信息。`;
        alert(msg);
        uiStatus.innerText = "模型加载失败";
        uiStatus.className = "status-bar mb-6 bg-red-100 text-red-600";
    } finally {
        uiLoading.classList.add('hidden');
    }
}

function initC4UI() {
    const btnContainer = document.getElementById('c4-buttons');
    const gridContainer = document.getElementById('c4-grid');
    btnContainer.innerHTML = '';
    gridContainer.innerHTML = '';
    
    for(let c=0; c<7; c++) {
        const btn = document.createElement('button');
        btn.className = 'c4-btn';
        btn.innerHTML = '▼';
        btn.onclick = () => handleInput(c); // Col index
        btn.id = `c4-btn-${c}`;
        btnContainer.appendChild(btn);
    }
    
    for(let r=0; r<6; r++) {
        for(let c=0; c<7; c++) {
            const cell = document.createElement('div');
            cell.className = 'c4-cell';
            cell.id = `c4-cell-${r}-${c}`;
            gridContainer.appendChild(cell);
        }
    }
}

function updatePlayerSide() {
    const radios = document.getElementsByName('playerSide');
    for (const r of radios) if (r.checked) playerSide = r.value;
    resetGame();
}

function resetGame() {
    gameState = gameEngine.getInitialState();
    currentToPlay = 1;
    historyStack = [];
    isAiThinking = false;
    
    drawBoard();
    updateStatus();
    updateAnalysis(0.5, null);

    // If human is second, AI moves first
    if (playerSide === 'second') {
        setTimeout(runAiMove, 500);
    }
}

function undoMove() {
    if (isAiThinking || historyStack.length < 2) return;
    
    // Revert 2 steps (Human + AI)
    historyStack.pop(); // Pop AI move
    const prev = historyStack.pop(); // Pop Human move
    
    gameState = prev.state;
    currentToPlay = prev.toPlay;
    
    drawBoard();
    updateStatus();
}

// Unified Input Handler
async function handleInput(action) {
    if (isAiThinking) return;
    
    const win = gameEngine.checkWin(gameState);
    if (win !== null) return;
    
    // Validate human turn
    const humanColor = playerSide === 'first' ? 1 : -1;
    if (currentToPlay !== humanColor) return;

    // Validate Move
    if (activeGameType === 'c4') {
        // For C4, action is column. Check if top is empty
        const board = gameEngine._getBoard(gameState, gameEngine.historyStep - 1);
        if (board[action] !== 0) return; // Col full
    } else {
        // TTT / Gomoku: action is index
        const board = gameEngine._getBoard(gameState, gameEngine.historyStep - 1);
        if (board[action] !== 0) return; // Occupied
    }

    // Execute Human Move
    pushHistory();
    gameState = gameEngine.getNextState(gameState, action, currentToPlay);
    currentToPlay = -currentToPlay;
    
    drawBoard();
    
    const result = gameEngine.checkWin(gameState);
    if (result !== null) {
        updateStatus(result);
    } else {
        updateStatus();
        await runAiMove();
    }
}

async function runAiMove() {
    isAiThinking = true;
    updateStatus();
    
    const start = performance.now();
    
    // MCTS Search
    const mcts = new MCTS(gameEngine, currentSession, {
        ...currentConfig,
        onProgress: (current, total) => {
            const pct = Math.round((current / total) * 100);
            uiStatus.innerText = `思考中... ${pct}%`;
            // Optional: Update a visual progress bar if we had one in the status bar
        }
    });
    const result = await mcts.search(gameState, currentToPlay);
    
    const end = performance.now();
    uiInferenceTime.innerText = (end - start).toFixed(0);
    updateAnalysis(result.winRate, result.actionCounts);

    // Pick best move (most visited)
    let bestAction = -1;
    let maxN = -1;
    for(let i=0; i<result.actionCounts.length; i++) {
        if (result.actionCounts[i] > maxN) {
            maxN = result.actionCounts[i];
            bestAction = i;
        }
    }

    if (bestAction !== -1) {
        pushHistory();
        gameState = gameEngine.getNextState(gameState, bestAction, currentToPlay);
        currentToPlay = -currentToPlay;
        drawBoard();
    }

    isAiThinking = false;
    const win = gameEngine.checkWin(gameState);
    updateStatus(win);
}

function pushHistory() {
    // Clone state
    historyStack.push({
        state: new Float32Array(gameState),
        toPlay: currentToPlay
    });
}

// ==========================================
// 4. Rendering
// ==========================================

function drawBoard() {
    const board = gameEngine._getBoard(gameState, gameEngine.historyStep - 1); // Get current plane
    
    if (activeGameType === 'ttt') {
        uiBoardTTT.innerHTML = '';
        for(let i=0; i<9; i++) {
            const cell = document.createElement('div');
            cell.className = 'ttt-cell';
            if (board[i] === 1) cell.innerHTML = '<span class="ttt-x">✕</span>';
            else if (board[i] === -1) cell.innerHTML = '<span class="ttt-o">○</span>';
            cell.onclick = () => handleInput(i);
            uiBoardTTT.appendChild(cell);
        }
    } else if (activeGameType === 'c4') {
        for(let r=0; r<6; r++) {
            for(let c=0; c<7; c++) {
                const idx = r*7 + c;
                const cell = document.getElementById(`c4-cell-${r}-${c}`);
                cell.className = 'c4-cell';
                if (board[idx] === 1) cell.classList.add('c4-red');
                else if (board[idx] === -1) cell.classList.add('c4-yellow');
            }
        }
        // Update btns
        for(let c=0; c<7; c++) {
             const btn = document.getElementById(`c4-btn-${c}`);
             btn.disabled = board[c] !== 0; // Disable if top row filled
        }
    } else if (activeGameType === 'gomoku') {
        uiBoardGomoku.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'gomoku-grid';
        for(let i=0; i<81; i++) {
            const cell = document.createElement('div');
            cell.className = 'gomoku-cell';
            cell.onclick = () => handleInput(i);
            if (board[i] === 1) cell.innerHTML = '<div class="gomoku-stone gomoku-black"></div>';
            else if (board[i] === -1) cell.innerHTML = '<div class="gomoku-stone gomoku-white"></div>';
            grid.appendChild(cell);
        }
        uiBoardGomoku.appendChild(grid);
    }
}

function updateStatus(winner = null) {
    if (winner !== null) {
        if (winner === 0) {
            uiStatus.innerText = "平局";
            uiStatus.className = "status-bar mb-6 bg-pink-100 text-pink-600";
        } else {
            const human = playerSide === 'first' ? 1 : -1;
            if (winner === human) {
                uiStatus.innerText = "🎉 你赢了!";
                uiStatus.className = "status-bar mb-6 bg-red-100 text-red-600";
            } else {
                uiStatus.innerText = "🤖 SkyZero 获胜!";
                uiStatus.className = "status-bar mb-6 bg-green-100 text-green-600";
            }
        }
    } else {
        if (isAiThinking) {
            uiStatus.innerText = "思考中... (MCTS)";
            uiStatus.className = "status-bar mb-6 bg-indigo-100 text-indigo-600";
        } else {
            const human = playerSide === 'first' ? 1 : -1;
            if (currentToPlay === human) {
                uiStatus.innerText = "轮到你了";
                uiStatus.className = "status-bar mb-6 bg-blue-100 text-blue-600";
            } else {
                uiStatus.innerText = "等待中...";
                uiStatus.className = "status-bar mb-6 bg-gray-100 text-gray-600";
            }
        }
    }
}

function updateAnalysis(winRate, counts) {
    // WinRate Bar
    const pct = (winRate * 100).toFixed(1);
    uiWinRateText.innerText = `${pct}%`;
    uiWinRateBar.style.width = `${pct}%`;
    uiWinRateBar.className = `h-2.5 rounded-full transition-all duration-500 ${winRate > 0.5 ? 'bg-green-500' : 'bg-red-400'}`;

    // Policy Visualization
    const container = document.getElementById('policy-container');
    container.innerHTML = '';
    
    if (!counts) {
        container.innerHTML = '<p class="text-gray-400 text-xs">等待分析...</p>';
        return;
    }

    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    if (activeGameType === 'c4') {
        // Bar Chart for Connect 4
        const chart = document.createElement('div');
        chart.className = 'policy-bar-container';
        
        // Find max for scaling
        const maxCount = Math.max(...counts);
        
        for(let c=0; c<7; c++) {
            const prob = counts[c] / total;
            const wrapper = document.createElement('div');
            wrapper.className = 'policy-bar-wrapper';
            
            const bar = document.createElement('div');
            bar.className = 'policy-bar';
            // Scale bar relative to highest prob for better visualization, but cap it?
            // Actually, let's just use absolute probability height.
            // If prob is 0.5, height is 50%.
            bar.style.height = `${Math.max(4, prob * 100)}%`; 
            
            // Color logic
            const isBest = counts[c] === maxCount && counts[c] > 0;
            if (isBest) {
                bar.style.backgroundColor = '#ef4444'; // Red-500 (Best)
                bar.style.opacity = '1';
            } else {
                bar.style.backgroundColor = '#ef4444'; 
                bar.style.opacity = Math.max(0.3, prob + 0.2);
            }
            
            const label = document.createElement('div');
            label.className = 'policy-label';
            // Show % only if > 0, but use non-breaking space to maintain height
            label.innerHTML = prob > 0.01 ? (prob * 100).toFixed(0) + '%' : '&nbsp;';
            
            wrapper.appendChild(bar);
            wrapper.appendChild(label);
            chart.appendChild(wrapper);
        }
        container.appendChild(chart);
        
    } else {
        // Grid Heatmap for TTT / Gomoku
        const size = activeGameType === 'ttt' ? 3 : 9;
        const grid = document.createElement('div');
        grid.className = 'policy-heatmap-grid';
        grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${size}, 1fr)`;
        
        // Calculate cell size to fit container, maintaining aspect ratio
        // Container has w-full min-h-[200px].
        // Let's rely on CSS Grid + specific width/height.
        const dim = Math.min(container.offsetWidth, container.offsetHeight || 200) - 20;
        grid.style.width = `${dim}px`;
        grid.style.height = `${dim}px`;
        
        const board = gameEngine._getBoard(gameState, gameEngine.historyStep - 1);
        const maxCount = Math.max(...counts);

        for(let i=0; i<size*size; i++) {
            const cell = document.createElement('div');
            cell.className = 'policy-heatmap-cell';
            
            const prob = counts[i] / total;
            
            // Board state check
            if (board[i] !== 0) {
                 cell.style.backgroundColor = '#CBD5E1'; // Occupied (Slate-300)
            } else if (counts[i] > 0) {
                 // Red intensity
                 // Use relative to max for better contrast
                 const intensity = counts[i] / maxCount;
                 cell.style.backgroundColor = `rgba(239, 68, 68, ${Math.max(0.2, intensity)})`;
                 
                 // Tooltip or Text
                 if (size === 3 && prob > 0.01) {
                     cell.innerHTML = `<span class="text-xs text-white font-bold">${(prob*100).toFixed(0)}</span>`;
                     cell.style.display = 'flex';
                     cell.style.alignItems = 'center';
                     cell.style.justifyContent = 'center';
                 }
                 cell.title = `Prob: ${(prob*100).toFixed(1)}%`;
            } else {
                 cell.style.backgroundColor = '#F1F5F9'; // Empty (Slate-100)
            }
            grid.appendChild(cell);
        }
        container.appendChild(grid);
    }
}
