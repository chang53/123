// 初始化 GUN，使用多個公共 relay peers
const gun = Gun({
    peers: [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://gun-us.herokuapp.com/gun',
        'https://gun-eu.herokuapp.com/gun'
    ],
    localStorage: false  // 避免本地存儲衝突
});

// 遊戲狀態
const game = gun.get('drawingGame');
const players = game.get('players');
const drawings = game.get('drawings');
const messages = game.get('messages');
const gameState = game.get('gameState');
const customWord = game.get('customWord');

// 監聽自訂題目變更
customWord.on((data) => {
    if (data && data.word) {
        currentWord = data.word;
        if (currentPlayer && currentPlayer.role === 'drawer') {
            document.getElementById('word-display').textContent = `請畫出：${currentWord}`;
        }
    }
});

// 遊戲變數
let currentPlayer = null;
let isDrawing = false;
let canvas, ctx;

// 遊戲設定
const GAME_SETTINGS = {
    roundTime: 60, // 每輪遊戲時間（秒）
    words: ['貓', '狗', '火車', '飛機', '電腦', '手機', '書', '樹', '太陽', '月亮', '房子', '汽車']
};

let currentWord = '';
let timer = null;
let roundInProgress = false;

// 畫布設置
function initializeCanvas() {
    canvas = document.getElementById('drawing-board');
    ctx = canvas.getContext('2d');
    
    // 設置畫布大小
    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 畫布事件監聽
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
}

// 繪畫功能
function startDrawing(e) {
    if (!currentPlayer || currentPlayer.role !== 'drawer') return;
    isDrawing = true;
    draw(e);
}

function draw(e) {
    if (!isDrawing) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const colorPicker = document.getElementById('color-picker');
    const brushSize = document.getElementById('brush-size').value;
    
    const drawData = {
        x,
        y,
        color: colorPicker.value,
        size: brushSize,
        timestamp: Date.now()
    };
    
    // 本地繪製
    ctx.beginPath();
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.strokeStyle = colorPicker.value;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    // 同步到其他玩家
    drawings.set(drawData);
}

function stopDrawing() {
    isDrawing = false;
}

// 監聽繪畫數據
drawings.on((data) => {
    if (!data || !ctx || data.clear) {
        if (data?.clear) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
    }
    
    ctx.beginPath();
    ctx.lineWidth = data.size;
    ctx.lineCap = 'round';
    ctx.strokeStyle = data.color;
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(data.x, data.y);
});

// 玩家管理
function joinGame() {
    const nameInput = document.getElementById('player-name');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('請輸入名字！');
        return;
    }

    // 檢查是否已有畫圖者
    players.once((allPlayers) => {
        const isFirstPlayer = !allPlayers || Object.keys(allPlayers).length === 0;
        
        currentPlayer = {
            id: Math.random().toString(36).substr(2, 9),
            name: name,
            role: isFirstPlayer ? 'drawer' : 'guesser',
            score: 0
        };
        
        players.get(currentPlayer.id).put(currentPlayer);
        
        document.getElementById('join-game').disabled = true;
        nameInput.disabled = true;
        
        // 系統訊息
        addMessage({
            type: 'system',
            content: `${name} 加入了遊戲！${isFirstPlayer ? '（畫圖者）' : ''}`
        });

        // 如果是第一位玩家，直接開始新回合
        if (isFirstPlayer) {
            startNewRound();
        }
    });
}

// 提交自訂題目
function submitCustomWord() {
    if (!currentPlayer || currentPlayer.role !== 'drawer' || roundInProgress) return;
    
    const wordInput = document.getElementById('custom-word');
    const word = wordInput.value.trim();
    
    if (!word) {
        alert('請輸入題目！');
        return;
    }
    
    customWord.put({ word, timestamp: Date.now() });
    wordInput.value = '';
    startNewRound();
}

// 開始新回合
function startNewRound() {
    if (roundInProgress) return;
    
    // 如果是畫圖者，等待輸入題目
    if (currentPlayer && currentPlayer.role === 'drawer') {
        document.getElementById('word-display').textContent = '請輸入題目';
        document.getElementById('tools').classList.remove('hidden');
        document.getElementById('custom-word').focus();
        return;
    }
    
    // 更新遊戲狀態
    roundInProgress = true;
    gameState.put({
        status: 'playing',
        timestamp: Date.now()
    });
    
    // 清除畫布
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawings.set({clear: true, timestamp: Date.now()});
    }
    
    // 顯示等待訊息給猜謎者
    if (currentPlayer && currentPlayer.role === 'guesser') {
        document.getElementById('word-display').textContent = '等待出題者輸入題目...';
        document.getElementById('tools').classList.add('hidden');
    }
}

// 計時器功能
function startTimer() {
    let timeLeft = GAME_SETTINGS.roundTime;
    document.getElementById('timer').textContent = `剩餘時間：${timeLeft}秒`;
    
    if (timer) clearInterval(timer);
    
    timer = setInterval(() => {
        timeLeft--;
        document.getElementById('timer').textContent = `剩餘時間：${timeLeft}秒`;
        
        if (timeLeft <= 0) {
            endRound('時間到！');
        }
    }, 1000);
}

// 結束回合
function endRound(reason) {
    clearInterval(timer);
    roundInProgress = false;
    
    addMessage({
        type: 'system',
        content: `回合結束 - ${reason}正確答案是：${currentWord}`
    });
    
    // 清除自訂題目
    customWord.put(null);
    
    // 5秒後開始新回合
    setTimeout(startNewRound, 5000);
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

// 顯示訊息
messages.on((data) => {
    if (!data) return;
    
    const messagesDiv = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    
    if (data.type === 'system') {
        messageElement.classList.add('system');
    }
    
    messageElement.textContent = data.type === 'system' 
        ? data.content 
        : `${data.player}: ${data.content}`;
    
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

// 事件監聽
document.getElementById('join-game').addEventListener('click', joinGame);
document.getElementById('send-message').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
document.getElementById('clear-canvas').addEventListener('click', () => {
    if (currentPlayer?.role === 'drawer') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawings.set({clear: true, timestamp: Date.now()});
    }
});
document.getElementById('submit-word').addEventListener('click', submitCustomWord);
document.getElementById('custom-word').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitCustomWord();
});

// 初始化
initializeCanvas();