// 初始化 GUN
const gun = Gun({
    peers: [
        'https://gun-manhattan.herokuapp.com/gun'
    ],
    localStorage: false,
    radisk: false,
    file: false
});

// 遊戲設定
const GAME_SETTINGS = {
    roundTime: 60,  // 每輪遊戲時間（秒）
    words: ['貓', '狗', '火車', '飛機', '電腦', '手機', '書', '樹', '太陽', '月亮', '房子', '汽車']
};

// 遊戲狀態 - 使用固定的遊戲房間名稱
const gameRoom = 'drawingGame-public-room';  // 固定的遊戲房間名稱
const game = gun.get(gameRoom);
const players = game.get('players');
const drawings = game.get('drawings');
const messages = game.get('messages');
const gameState = game.get('gameState');
const customWord = game.get('customWord');  // 添加自訂題目的狀態

// 遊戲變數
let currentPlayer = null;
let canvas, ctx;
let currentWord = '';
let timer = null;
let roundInProgress = false;
let isDrawing = false;
let lastX = null;
let lastY = null;
let lastDrawing = null;

// 畫布設置
function initializeCanvas() {
    canvas = document.getElementById('drawing-board');
    ctx = canvas.getContext('2d');
    
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 移除舊的事件監聽器
    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);
    canvas = newCanvas;
    ctx = canvas.getContext('2d');

    // 重新添加事件監聽器
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // 設置畫布預設樣式
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function startDrawing(e) {
    if (!currentPlayer || currentPlayer.role !== 'drawer' || !roundInProgress) return;
    
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

function draw(e) {
    if (!isDrawing || !currentPlayer || currentPlayer.role !== 'drawer' || !roundInProgress) return;
    
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    // 只有當有上一個點時才畫線
    if (lastX !== null && lastY !== null) {
        const colorPicker = document.getElementById('color-picker');
        const brushSize = document.getElementById('brush-size').value;
        
        // 本地繪製
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = brushSize;
        ctx.stroke();
        
        // 同步到其他玩家
        drawings.set({
            type: 'line',
            startX: lastX,
            startY: lastY,
            endX: currentX,
            endY: currentY,
            color: colorPicker.value,
            size: brushSize,
            timestamp: Date.now()
        });
    }
    
    lastX = currentX;
    lastY = currentY;
}

function stopDrawing() {
    isDrawing = false;
    lastX = null;
    lastY = null;
}

// 修改監聽繪畫數據的邏輯
drawings.on((data) => {
    if (!data || !ctx) return;
    
    // 避免重複處理同一個繪圖數據
    if (lastDrawing && lastDrawing.timestamp === data.timestamp) return;
    lastDrawing = data;
    
    if (data.clear) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }
    
    if (data.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(data.startX, data.startY);
        ctx.lineTo(data.endX, data.endY);
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    }
});

// 修改玩家管理邏輯
function joinGame() {
    const nameInput = document.getElementById('player-name');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('請輸入名字！');
        return;
    }

    // 禁用輸入和按鈕，避免重複點擊
    nameInput.disabled = true;
    document.getElementById('join-game').disabled = true;

    const playerId = 'player-' + Math.random().toString(36).substr(2, 9);
    
    // 使用 once 檢查現有玩家
    players.once((allPlayers) => {
        console.log('檢查現有玩家:', allPlayers);
        
        const existingPlayers = allPlayers ? Object.values(allPlayers).filter(p => p && p.name) : [];
        const isFirstPlayer = existingPlayers.length === 0;
        
        // 創建玩家資料
        currentPlayer = {
            id: playerId,
            name: name,
            role: isFirstPlayer ? 'drawer' : 'guesser',
            score: 0,
            timestamp: Date.now()
        };
        
        // 儲存玩家資料
        players.get(playerId).put(currentPlayer, (ack) => {
            console.log('玩家資料已儲存:', ack);
            
            // 更新介面
            document.getElementById('current-role').textContent = 
                `你的角色：${currentPlayer.role === 'drawer' ? '畫圖者' : '猜謎者'}`;
            
            // 顯示或隱藏工具
            if (currentPlayer.role === 'drawer') {
                document.getElementById('tools').classList.remove('hidden');
                document.getElementById('word-display').textContent = '請輸入你要畫的題目';
                document.getElementById('drawing-tools').style.display = 'none';
            } else {
                document.getElementById('tools').classList.add('hidden');
                document.getElementById('word-display').textContent = '等待畫圖者出題...';
            }
            
            // 發送系統訊息
            addMessage({
                type: 'system',
                content: `${name} 加入了遊戲！${isFirstPlayer ? '（畫圖者）' : ''}`
            });
            
            // 開始心跳檢查
            startHeartbeat();
        });
    });
}

// 提交題目
function submitWord() {
    if (!currentPlayer || currentPlayer.role !== 'drawer' || roundInProgress) return;
    
    const wordInput = document.getElementById('custom-word');
    const word = wordInput.value.trim();
    
    if (!word) {
        alert('請輸入題目！');
        return;
    }
    
    // 廣播題目（只有答案的長度）
    const wordLength = word.length;
    gameState.get('wordHint').put({
        length: wordLength,
        timestamp: Date.now()
    });
    
    // 開始新回合
    startNewRound(word);
    
    // 發送系統訊息
    addMessage({
        type: 'system',
        content: `遊戲開始！題目是 ${wordLength} 個字`
    });

    // 確保畫圖工具可見
    document.getElementById('drawing-tools').style.display = 'flex';
    document.getElementById('word-input-area').style.display = 'none';
}

// 開始新回合
function startNewRound(word) {
    if (roundInProgress) return;
    
    currentWord = word;
    roundInProgress = true;
    
    // 更新遊戲狀態
    gameState.put({
        status: 'playing',
        timestamp: Date.now()
    });
    
    // 清除畫布
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawings.set({clear: true, timestamp: Date.now()});
    }
    
    // 顯示題目給畫圖者
    if (currentPlayer?.role === 'drawer') {
        document.getElementById('word-display').textContent = `請畫出：${currentWord}`;
        document.getElementById('drawing-tools').style.display = 'flex';
        document.getElementById('word-input-area').style.display = 'none';
        
        // 確保畫布可以使用
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'crosshair';
    }
    
    // 開始計時
    startTimer();
}

// 監聽遊戲狀態
gameState.get('wordHint').on((data) => {
    if (data && currentPlayer?.role === 'guesser') {
        document.getElementById('word-display').textContent = 
            `題目是 ${data.length} 個字的詞`;
    }
});

// 修改計時器功能
function startTimer() {
    let timeLeft = GAME_SETTINGS.roundTime;
    
    // 更新計時器顯示
    function updateTimer() {
        document.getElementById('timer').textContent = `剩餘時間：${timeLeft}秒`;
    }
    
    // 清除現有計時器
    if (timer) {
        clearInterval(timer);
    }
    
    updateTimer();
    
    // 設置新計時器
    timer = setInterval(() => {
        timeLeft--;
        updateTimer();
        
        // 同步遊戲狀態
        gameState.get('timer').put({
            timeLeft,
            timestamp: Date.now()
        });
        
        if (timeLeft <= 0) {
            endRound('時間到！');
        }
    }, 1000);
}

// 修改結束回合邏輯
function endRound(reason) {
    clearInterval(timer);
    roundInProgress = false;
    
    // 清除畫布
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawings.set({clear: true, timestamp: Date.now()});
    }
    
    // 發送系統訊息
    addMessage({
        type: 'system',
        content: `回合結束 - ${reason}正確答案是：${currentWord}`
    });
    
    // 重置遊戲狀態
    gameState.put({
        status: 'waiting',
        timestamp: Date.now()
    });
    
    // 如果是畫圖者，顯示出題區域
    if (currentPlayer?.role === 'drawer') {
        document.getElementById('word-display').textContent = '請輸入新的題目';
        document.getElementById('drawing-tools').style.display = 'none';
        document.getElementById('word-input-area').style.display = 'flex';
        document.getElementById('custom-word').value = '';
        document.getElementById('custom-word').focus();
    } else {
        document.getElementById('word-display').textContent = '等待畫圖者出題...';
    }
}

// 聊天功能
function sendMessage() {
    if (!currentPlayer) return;
    
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content) return;
    
    // 檢查是否猜對
    if (roundInProgress && currentPlayer.role === 'guesser' && content === currentWord) {
        endRound(`${currentPlayer.name}猜對了！`);
        currentPlayer.score += 10;
        players.get(currentPlayer.id).put(currentPlayer);
    }
    
    const message = {
        player: currentPlayer.name,
        content,
        timestamp: Date.now()
    };
    
    messages.set(message);
    input.value = '';
}

// 修改訊息顯示系統
function addMessage(message) {
    const finalMessage = {
        ...message,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now()
    };
    
    messages.get(finalMessage.id).put(finalMessage);
}

// 修改訊息監聽邏輯
messages.on((data, key) => {
    if (!data || !data.timestamp) return;
    
    const messagesDiv = document.getElementById('messages');
    const existingMessage = document.getElementById(`msg-${key}`);
    
    if (existingMessage) return; // 避免重複訊息
    
    const messageElement = document.createElement('div');
    messageElement.id = `msg-${key}`;
    messageElement.classList.add('message');
    
    if (data.type === 'system') {
        messageElement.classList.add('system');
    }
    
    messageElement.textContent = data.type === 'system' 
        ? data.content 
        : `${data.player}: ${data.content}`;
    
    // 保持訊息順序
    const messages = Array.from(messagesDiv.children);
    const insertIndex = messages.findIndex(msg => {
        const msgTimestamp = parseInt(msg.dataset.timestamp || '0');
        return msgTimestamp > data.timestamp;
    });
    
    messageElement.dataset.timestamp = data.timestamp;
    
    if (insertIndex === -1) {
        messagesDiv.appendChild(messageElement);
    } else {
        messagesDiv.insertBefore(messageElement, messages[insertIndex]);
    }
    
    // 保持滾動到最新訊息
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // 限制訊息數量
    while (messagesDiv.children.length > 100) {
        messagesDiv.removeChild(messagesDiv.firstChild);
    }
});

// 更新玩家列表顯示
players.on((data) => {
    if (!data) return;
    
    const playersList = document.getElementById('players-list');
    playersList.innerHTML = '';
    
    Object.values(data).forEach(player => {
        if (player && player.name) {
            const playerElement = document.createElement('div');
            playerElement.textContent = `${player.name} (${player.score}分) ${player.role === 'drawer' ? '- 畫畫中' : ''}`;
            playersList.appendChild(playerElement);
        }
    });
});

// 新增一個函數來檢查斷線的玩家
function setupPlayerChecks() {
    setInterval(() => {
        players.once((data) => {
            if (!data) return;
            
            const now = Date.now();
            Object.entries(data).forEach(([id, player]) => {
                if (player && player.timestamp && (now - player.timestamp > 30000)) {
                    // 移除超過 30 秒沒有更新的玩家
                    players.get(id).put(null);
                    addMessage({
                        type: 'system',
                        content: `${player.name} 已離線`
                    });
                }
            });
        });
    }, 10000);
}

// 新增玩家心跳檢查
function startHeartbeat() {
    if (!currentPlayer) return;
    
    // 清除可能存在的舊計時器
    if (window.heartbeatInterval) {
        clearInterval(window.heartbeatInterval);
    }
    
    // 設置新的心跳檢查
    window.heartbeatInterval = setInterval(() => {
        if (currentPlayer) {
            currentPlayer.timestamp = Date.now();
            players.get(currentPlayer.id).put(currentPlayer);
        }
    }, 5000);
}

// 修改啟動邏輯
function initialize() {
    initializeCanvas();
    setupEventListeners();
    setupPlayerChecks();
}

// 確保事件監聽器只綁定一次
function setupEventListeners() {
    // 清除所有現有的事件監聽器
    const elements = {
        join: document.getElementById('join-game'),
        name: document.getElementById('player-name'),
        send: document.getElementById('send-message'),
        message: document.getElementById('message-input'),
        clear: document.getElementById('clear-canvas'),
        submit: document.getElementById('submit-word'),
        word: document.getElementById('custom-word')
    };

    // 複製並替換所有元素以移除舊的事件監聽器
    Object.keys(elements).forEach(key => {
        const element = elements[key];
        if (element) {
            const newElement = element.cloneNode(true);
            element.parentNode.replaceChild(newElement, element);
            elements[key] = newElement;
        }
    });

    // 重新綁定事件監聽器
    elements.join?.addEventListener('click', joinGame);
    elements.name?.addEventListener('keypress', e => {
        if (e.key === 'Enter') joinGame();
    });
    elements.send?.addEventListener('click', sendMessage);
    elements.message?.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendMessage();
    });
    elements.clear?.addEventListener('click', () => {
        if (currentPlayer?.role === 'drawer') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawings.set({clear: true, timestamp: Date.now()});
        }
    });
    elements.submit?.addEventListener('click', submitWord);
    elements.word?.addEventListener('keypress', e => {
        if (e.key === 'Enter') submitWord();
    });
}

// 等待 DOM 載入完成後再初始化
window.addEventListener('load', () => {
    initialize();
});