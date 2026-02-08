document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const userGrid = document.querySelector('#user-grid');
    const enemyGrid = document.querySelector('#enemy-grid');
    const statusDisplay = document.querySelector('#status');
    const logBox = document.querySelector('#game-log');

    const width = 10;
    const userSquares = [];
    const enemySquares = [];
    
    let isGameOver = false;
    let currentPlayer = 'user';
    let playerNum = -1;
    let ready = false;
    let myShips = []; 

    // --- Helper Functions ---
    function getCoordinate(index) {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
        const row = Math.floor(index / width);
        const col = index % width;
        return `${letters[row]}${col + 1}`;
    }

    function addLog(msg, className) {
        const p = document.createElement('p');
        p.innerText = `> ${msg}`; // Using innerText for safety
        if (className) p.classList.add(className);
        logBox.appendChild(p);
        logBox.scrollTop = logBox.scrollHeight;
    }

    // --- 1. Create Boards ---
    function createBoard(grid, squares) {
        // Corner
        const corner = document.createElement('div');
        corner.classList.add('label');
        grid.appendChild(corner);

        // Headers
        for (let i = 1; i <= width; i++) {
            const label = document.createElement('div');
            label.textContent = i;
            label.classList.add('label');
            grid.appendChild(label);
        }

        // Main Grid
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
        for (let i = 0; i < width * width; i++) {
            if (i % width === 0) {
                const rowLabel = document.createElement('div');
                rowLabel.textContent = letters[Math.floor(i / width)];
                rowLabel.classList.add('label');
                grid.appendChild(rowLabel);
            }
            const square = document.createElement('div');
            square.dataset.id = i;
            square.classList.add('cell');
            grid.appendChild(square);
            squares.push(square);
        }
    }

    createBoard(userGrid, userSquares);
    createBoard(enemyGrid, enemySquares);

    // --- 2. Generate Ships ---
    function generateShips() {
        const shipSizes = [5, 4, 3, 3, 2];
        myShips = [];
        userSquares.forEach(sq => sq.classList.remove('ship'));

        for (let size of shipSizes) {
            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 500) {
                attempts++;
                const startIndex = Math.floor(Math.random() * 100);
                const isHorizontal = Math.random() > 0.5;
                const shipIndices = [];
                let valid = true;

                for (let i = 0; i < size; i++) {
                    let index;
                    if (isHorizontal) {
                        index = startIndex + i;
                        if (Math.floor(startIndex / width) !== Math.floor(index / width)) {
                            valid = false; break;
                        }
                    } else {
                        index = startIndex + (i * width);
                        if (index >= 100) { valid = false; break; }
                    }
                    if (valid && userSquares[index].classList.contains('ship')) {
                        valid = false; break;
                    }
                    shipIndices.push(index);
                }

                if (valid) {
                    shipIndices.forEach(idx => userSquares[idx].classList.add('ship'));
                    myShips.push({ location: shipIndices, hits: 0, size: size });
                    placed = true;
                }
            }
        }
        addLog("Fleet deployed. Waiting for server...");
    }
    generateShips();

    // --- 3. Click Logic ---
    enemyGrid.addEventListener('click', (e) => {
        const cell = e.target.closest('.cell');
        if (!cell) return;

        const id = cell.dataset.id;
        
        if (!ready) {
            return addLog("Waiting for Player 2 to connect...");
        }
        if (isGameOver) return;
        if (currentPlayer === 'enemy') {
            return addLog("It is NOT your turn.");
        }
        if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;

        // Valid Fire
        const coord = getCoordinate(id);
        addLog(`Firing at ${coord}...`);
        
        // Optimistic Update
        currentPlayer = 'enemy';
        statusDisplay.innerHTML = "Enemy's Turn";
        statusDisplay.style.color = "red";
        
        socket.emit('fire', id);
    });

    // --- 4. Socket Events ---
    socket.on('player-number', (num) => {
        playerNum = num;
        if (num === -1) {
            statusDisplay.innerHTML = "Server Full";
        } else {
            statusDisplay.innerHTML = "Waiting for Player 2...";
            addLog(`You are Player ${num + 1}`);
        }
    });

    socket.on('player-disconnected', () => {
        statusDisplay.innerHTML = "Opponent Disconnected";
        statusDisplay.style.color = "red";
        addLog("Opponent disconnected! Refresh to restart.", "log-alert");
        isGameOver = true;
    });

    socket.on('game-start', () => {
        ready = true;
        statusDisplay.innerHTML = "Game Started!";
        if (playerNum === 0) {
            currentPlayer = 'user';
            statusDisplay.innerHTML = "YOUR TURN";
            statusDisplay.style.color = "green";
            addLog("Game Started! You fire first.", "log-success");
        } else {
            currentPlayer = 'enemy';
            statusDisplay.innerHTML = "Enemy's Turn";
            statusDisplay.style.color = "red";
            addLog("Game Started! Prepare defense.", "log-alert");
        }
    });

    socket.on('opponent-fire', (id) => {
        if (isGameOver) return;
        const square = userSquares[id];
        const coord = getCoordinate(id);
        let result = 'miss';
        let sunkShipSize = null;

        if (square.classList.contains('ship')) {
            square.classList.add('hit');
            result = 'hit';
            
            const ship = myShips.find(s => s.location.includes(parseInt(id)));
            if (ship) {
                ship.hits++;
                if (ship.hits === ship.size) {
                    result = 'sunk';
                    sunkShipSize = ship.size;
                    addLog(`CRITICAL: They sunk your size-${ship.size} ship at ${coord}!`, "log-alert");
                } else {
                    addLog(`Hit taken at ${coord}!`, "log-alert");
                }
            }
        } else {
            square.classList.add('miss');
            addLog(`Opponent missed at ${coord}.`);
        }

        socket.emit('fire-reply', { result, id, sunkShipSize });
        
        currentPlayer = 'user';
        statusDisplay.innerHTML = "YOUR TURN";
        statusDisplay.style.color = "green";
    });

    socket.on('fire-reply', (data) => {
        const square = enemySquares[data.id];
        const coord = getCoordinate(data.id);

        if (data.result === 'hit' || data.result === 'sunk') {
            square.classList.add('hit');
            if (data.result === 'sunk') {
                addLog(`TARGET DESTROYED at ${coord}!`, "log-success");
            } else {
                addLog(`Direct HIT at ${coord}!`, "log-success");
            }
        } else {
            square.classList.add('miss');
            addLog(`Shot missed at ${coord}.`);
        }
    });
});