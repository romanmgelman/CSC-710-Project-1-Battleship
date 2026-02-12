document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const userGrid = document.querySelector('#user-grid');
    const enemyGrid = document.querySelector('#enemy-grid');
    const statusDisplay = document.querySelector('#status');
    const logBox = document.querySelector('#game-log');
    
    // Panels
    const setupPanel = document.querySelector('#setup-panel');
    const placementControls = document.querySelector('#placement-controls');
    const instructionText = document.querySelector('#placement-instruction');
    
    // Buttons
    const shipSelect = document.querySelector('#ship-count');
    const startSetupBtn = document.querySelector('#start-setup-btn');
    const rotateBtn = document.querySelector('#rotate-btn');

    const width = 10;
    const userSquares = [];
    const enemySquares = [];
    
    // GAME STATE
    let isGameOver = false;
    let currentPlayer = 'user';
    let playerNum = -1;
    let gamePhase = 'waiting'; // 'waiting', 'placement', 'battle'
    let myShips = []; 
    
    // PLACEMENT STATE
    let shipsToPlace = []; 
    let currentPlaceIndex = 0;
    let isHorizontal = true;
    let lastHoveredCell = null; // Track mouse position for 'R' key rotation

    // --- Helpers ---
    function addLog(msg, className) {
        const p = document.createElement('p');
        p.innerText = `> ${msg}`;
        if (className) p.classList.add(className);
        logBox.appendChild(p);
        logBox.scrollTop = logBox.scrollHeight;
    }

    function getCoordinate(index) {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
        const row = Math.floor(index / width);
        const col = index % width;
        return `${letters[row]}${col + 1}`;
    }

    // --- 1. Create Boards ---
    function createBoard(grid, squares) {
        const corner = document.createElement('div');
        corner.classList.add('label');
        grid.appendChild(corner);
        for (let i = 1; i <= width; i++) {
            const label = document.createElement('div');
            label.textContent = i;
            label.classList.add('label');
            grid.appendChild(label);
        }
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

    // --- 2. Placement Logic ---
    
    function getShipIndices(startIndex, size, horizontal) {
        const indices = [];
        for (let i = 0; i < size; i++) {
            let index;
            if (horizontal) {
                index = parseInt(startIndex) + i;
                if (Math.floor(startIndex / width) !== Math.floor(index / width)) return null;
            } else {
                index = parseInt(startIndex) + (i * width);
                if (index >= 100) return null;
            }
            indices.push(index);
        }
        return indices;
    }

    // NEW: Centralized Ghost Ship Renderer
    function renderGhostShip(cell) {
        // Clear previous highlights
        userSquares.forEach(sq => {
            sq.classList.remove('valid-hover', 'invalid-hover');
        });

        if (!cell) return;

        const size = shipsToPlace[currentPlaceIndex];
        const startIndex = parseInt(cell.dataset.id);
        const indices = getShipIndices(startIndex, size, isHorizontal);

        if (!indices) {
            cell.classList.add('invalid-hover');
            return;
        }

        let valid = true;
        for (let idx of indices) {
            if (userSquares[idx].classList.contains('ship')) {
                valid = false;
                break;
            }
        }

        indices.forEach(idx => {
            userSquares[idx].classList.add(valid ? 'valid-hover' : 'invalid-hover');
        });
    }

    // Hover Event
    userGrid.addEventListener('mouseover', (e) => {
        if (gamePhase !== 'placement') return;
        const cell = e.target.closest('.cell');
        lastHoveredCell = cell; // Remember this for 'R' key
        renderGhostShip(cell);
    });

    userGrid.addEventListener('mouseleave', () => {
        lastHoveredCell = null;
        userSquares.forEach(sq => sq.classList.remove('valid-hover', 'invalid-hover'));
    });

    // NEW: Rotate Logic (Function for Button AND Key)
    function toggleRotation() {
        isHorizontal = !isHorizontal;
        rotateBtn.innerText = isHorizontal ? "Rotate: Horizontal (R)" : "Rotate: Vertical (R)";
        
        // Instant visual update if mouse is currently over the grid
        if (lastHoveredCell) {
            renderGhostShip(lastHoveredCell);
        }
    }

    rotateBtn.addEventListener('click', toggleRotation);

    // NEW: Keyboard Event Listener
    document.addEventListener('keydown', (e) => {
        if (gamePhase === 'placement' && e.key.toLowerCase() === 'r') {
            toggleRotation();
        }
    });

    // Place Ship Click
    userGrid.addEventListener('click', (e) => {
        if (gamePhase !== 'placement') return;
        const cell = e.target.closest('.cell');
        if (!cell) return;

        const size = shipsToPlace[currentPlaceIndex];
        const startIndex = parseInt(cell.dataset.id);
        const indices = getShipIndices(startIndex, size, isHorizontal);

        if (!indices) return; 

        for (let idx of indices) {
            if (userSquares[idx].classList.contains('ship')) {
                addLog("Invalid placement: Overlap!");
                return;
            }
        }

        indices.forEach(idx => userSquares[idx].classList.add('ship'));
        myShips.push({ location: indices, hits: 0, size: size });
        
        addLog(`Placed size-${size} ship.`);
        
        currentPlaceIndex++;
        
        if (currentPlaceIndex < shipsToPlace.length) {
            instructionText.innerText = `Place your Size ${shipsToPlace[currentPlaceIndex]} Ship`;
        } else {
            finishPlacement();
        }
    });

    function finishPlacement() {
        gamePhase = 'waiting_for_opponent';
        placementControls.classList.add('hidden');
        instructionText.innerText = "";
        userSquares.forEach(sq => sq.classList.remove('valid-hover', 'invalid-hover')); 
        
        addLog("All ships placed. Waiting for opponent...");
        statusDisplay.innerHTML = "Waiting for opponent...";
        socket.emit('player-ready');
    }

    // --- 3. Host Controls ---
    startSetupBtn.addEventListener('click', () => {
        const count = shipSelect.value;
        socket.emit('setup-game', count);
        setupPanel.classList.add('hidden');
    });

    // --- 4. Battle Logic ---
    enemyGrid.addEventListener('click', (e) => {
        if (gamePhase !== 'battle') return;
        
        const cell = e.target.closest('.cell');
        if (!cell) return;
        const id = cell.dataset.id;
        
        if (isGameOver) return;
        if (currentPlayer === 'enemy') return addLog("It is NOT your turn.");
        if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;

        const coord = getCoordinate(id);
        addLog(`Firing at ${coord}...`);
        
        currentPlayer = 'enemy';
        statusDisplay.innerHTML = "Enemy's Turn";
        statusDisplay.style.color = "red";
        
        socket.emit('fire', id);
    });

    // --- 5. Socket Events ---
    socket.on('player-number', (num) => {
        playerNum = num;
        if (num === 0) {
            statusDisplay.innerHTML = "You are the HOST.";
            setupPanel.classList.remove('hidden');
        } else {
            statusDisplay.innerHTML = "Waiting for Host...";
            setupPanel.classList.add('hidden');
        }
    });

    socket.on('players-connected', () => {
        if(playerNum === 0) addLog("Player 2 Connected.");
        else addLog("Connected to Host.");
    });

    socket.on('enter-placement-mode', (count) => {
        userSquares.forEach(sq => sq.className = 'cell');
        enemySquares.forEach(sq => sq.className = 'cell');
        myShips = [];
        
        shipsToPlace = [];
        // Generate ship sequence: 1, 1, 2, 2, 3... or just 1, 2, 3...
        // For this logic, we use standard 1 -> Count
        for(let i = 1; i <= parseInt(count); i++) {
            shipsToPlace.push(i);
        }
        currentPlaceIndex = 0;
        
        gamePhase = 'placement';
        setupPanel.classList.add('hidden');
        placementControls.classList.remove('hidden');
        statusDisplay.innerHTML = "Setup Phase";
        instructionText.innerText = `Place your Size ${shipsToPlace[0]} Ship`;
        rotateBtn.innerText = "Rotate: Horizontal (R)"; // Reset label
        
        addLog("Setup started! Place your ships.");
    });

    socket.on('game-start', () => {
        gamePhase = 'battle';
        statusDisplay.innerHTML = "BATTLE STARTED";
        
        if (playerNum === 0) {
            currentPlayer = 'user';
            statusDisplay.innerHTML = "YOUR TURN";
            statusDisplay.style.color = "green";
            addLog("Battle Started! You fire first.", "log-success");
        } else {
            currentPlayer = 'enemy';
            statusDisplay.innerHTML = "Enemy's Turn";
            statusDisplay.style.color = "red";
            addLog("Battle Started! Prepare defense.", "log-alert");
        }
    });

    socket.on('player-disconnected', () => {
        statusDisplay.innerHTML = "Opponent Disconnected";
        statusDisplay.style.color = "red";
        addLog("Opponent disconnected. Refresh to restart.", "log-alert");
        isGameOver = true;
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
                addLog(`CRITICAL: Size-${ship.size} ship sunk at ${coord}!`, "log-alert");
            } else {
                addLog(`Hit taken at ${coord}!`, "log-alert");
            }
        }
    } else {
        square.classList.add('miss');
        addLog(`Opponent missed at ${coord}.`);
    }
    
    // Check if all of my ships have been sunk
    const allSunk = myShips.every(ship => ship.hits === ship.size);
    
    if (allSunk) {
        isGameOver = true;
        statusDisplay.innerHTML = "DEFEAT - All Ships Destroyed";
        statusDisplay.style.color = "red";
        addLog("═══════════════════════════════", "log-alert");
        addLog("ALL YOUR SHIPS DESTROYED!", "log-alert");
        addLog("YOU LOST THE BATTLE", "log-alert");
        addLog("═══════════════════════════════", "log-alert");
        socket.emit('fire-reply', { result, id, sunkShipSize, gameOver: true, winner: 'enemy' });
        return; 
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
            addLog(`TARGET DESTROYED at ${coord}! Size-${data.sunkShipSize} ship eliminated!`, "log-success");
        } else {
            addLog(`Direct HIT at ${coord}!`, "log-success");
        }
    } else {
        square.classList.add('miss');
        addLog(`Shot missed at ${coord}.`);
    }
    
    if (data.gameOver && data.winner === 'enemy') {
        isGameOver = true;
        statusDisplay.innerHTML = "VICTORY - Enemy Fleet Destroyed!";
        statusDisplay.style.color = "green";
        addLog("═══════════════════════════════", "log-success");
        addLog("ALL ENEMY SHIPS DESTROYED!", "log-success");
        addLog("YOU WON THE BATTLE!", "log-success");
        addLog("═══════════════════════════════", "log-success");
    }
});
});