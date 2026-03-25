const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let waitingPlayer = null;
const roomData = {};

function getShipIndices(startIndex, size, horizontal) {
    const width = 10;
    const indices = [];

    for (let i = 0; i < size; i++) {
        let index;
        if (horizontal) {
            index = startIndex + i;
            if (Math.floor(startIndex / width) !== Math.floor(index / width)) return null;
        } else {
            index = startIndex + (i * width);
            if (index >= 100) return null;
        }
        indices.push(index);
    }

    return indices;
}

function placeAIShips(shipCount) {
    const ships = [];

    for (let size = 1; size <= shipCount; size++) {
        let placed = false;

        while (!placed) {
            const startIndex = Math.floor(Math.random() * 100);
            const horizontal = Math.random() < 0.5;
            const indices = getShipIndices(startIndex, size, horizontal);

            if (!indices) continue;

            const overlaps = indices.some(idx =>
                ships.some(ship => ship.location.includes(idx))
            );

            if (overlaps) continue;

            ships.push({
                location: indices,
                hits: 0,
                size
            });

            placed = true;
        }
    }

    return ships;
}

function getRandomAvailableShot(shotsTaken) {
    const available = [];

    for (let i = 0; i < 100; i++) {
        if (!shotsTaken.includes(i)) {
            available.push(i);
        }
    }

    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- MATCHMAKING ---
    if (waitingPlayer) {
        if (!waitingPlayer.connected) {
            waitingPlayer = socket;
            return;
        }

        const roomName = `${waitingPlayer.id}#${socket.id}`;
        socket.join(roomName);
        waitingPlayer.join(roomName);
        
        // Initialize Room Data
        roomData[roomName] = {
            readyCount: 0,
            shipCount: 5,
            rematchCount: 0
        };

        io.to(waitingPlayer.id).emit('player-number', 0); // Host
        io.to(socket.id).emit('player-number', 1);       // Guest
        
        io.to(roomName).emit('players-connected');
        waitingPlayer = null;
    } else {
        waitingPlayer = socket;
    }

    // --- PHASE 1: HOST CONFIGURES GAME ---
    socket.on('setup-game', (config) => {
        console.log('SETUP-GAME RECEIVED:', config);

        const { shipCount, gameMode, aiDifficulty } = config;

        if (gameMode === 'ai') {
            if (waitingPlayer === socket) {
                waitingPlayer = null;
            }

            const soloRoom = `ai#${socket.id}`;
            socket.join(soloRoom);

            roomData[soloRoom] = {
                readyCount: 0,
                shipCount: parseInt(shipCount),
                rematchCount: 0,
                gameMode: 'ai',
                aiDifficulty: aiDifficulty || 'easy',
                aiShips: placeAIShips(parseInt(shipCount)),
                aiShotsTaken: []
            };

            console.log('CREATED AI ROOM:', soloRoom, roomData[soloRoom]);

            io.to(socket.id).emit('enter-placement-mode', parseInt(shipCount));
            return;
        }

        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);

        if (gameRoom && roomData[gameRoom]) {
            roomData[gameRoom].shipCount = parseInt(shipCount);
            roomData[gameRoom].readyCount = 0;
            roomData[gameRoom].rematchCount = 0;
            roomData[gameRoom].gameMode = 'lan';
            roomData[gameRoom].aiDifficulty = null;

            io.in(gameRoom).emit('enter-placement-mode', parseInt(shipCount));
        }
});

    // --- PHASE 2: PLAYERS READY ---
    socket.on('player-ready', (data) => {
        console.log('PLAYER-READY RECEIVED FOR:', socket.id);

        const soloRoom = `ai#${socket.id}`;
        const rooms = Array.from(socket.rooms);
        const gameRoom = roomData[soloRoom] ? soloRoom : rooms.find(r => r !== socket.id);

        console.log('SOCKET ROOMS:', rooms);
        console.log('SELECTED GAME ROOM:', gameRoom);

        if (gameRoom && roomData[gameRoom]) {
            roomData[gameRoom].readyCount++;
            // NEW: Store hard mode targets
            if (data && data.hardMode && data.shipLocations) {
                const shuffled = [...data.shipLocations];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                roomData[gameRoom].hardModeTargets = shuffled;
                roomData[gameRoom].hardModeIndex = 0;
            }
            console.log('ROOM DATA:', roomData[gameRoom]);

            if (roomData[gameRoom].gameMode === 'ai') {
                if (roomData[gameRoom].readyCount === 1) {
                    console.log('STARTING AI GAME FOR:', socket.id);
                    io.to(socket.id).emit('game-start');
                }
            } else {
                if (roomData[gameRoom].readyCount === 2) {
                    io.in(gameRoom).emit('game-start');
                }
            }
        } else {
            console.log('NO VALID ROOM FOUND FOR PLAYER-READY');
        }
});

    socket.on('request-rematch', () => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);

        if (!gameRoom || !roomData[gameRoom]) return;

        const room = roomData[gameRoom];

        if (room.gameMode === 'ai') {
            room.readyCount = 0;
            room.rematchCount = 0;
            room.aiShips = placeAIShips(room.shipCount);
            room.aiShotsTaken = [];
            room.hardModeTargets = []; // NEW
            room.hardModeIndex = 0;

            io.to(socket.id).emit('rematch-start', room.shipCount);
            return;
        }

        room.rematchCount++;

        if (room.rematchCount === 2) {
            room.readyCount = 0;
            room.rematchCount = 0;

            const shipCount = room.shipCount ?? 5;
            io.in(gameRoom).emit('rematch-start', shipCount);
        } else {
            socket.to(gameRoom).emit('rematch-waiting');
            socket.emit('rematch-requested');
        }
});

    // --- PHASE 3: BATTLE ---
    socket.on('fire', (id) => {
        const shotId = parseInt(id);
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);

        console.log('FIRE EVENT:', { shotId, rooms, gameRoom });

        if (!gameRoom || !roomData[gameRoom]) return;

        const room = roomData[gameRoom];
        console.log('ROOM MODE:', room.gameMode);

        if (room.gameMode === 'ai') {
            let result = 'miss';
            let sunkShipSize = null;

            const ship = room.aiShips.find(s => s.location.includes(shotId));

            if (ship) {
                ship.hits++;
                if (ship.hits === ship.size) {
                    result = 'sunk';
                    sunkShipSize = ship.size;
                } else {
                    result = 'hit';
                }
            }

            const allSunk = room.aiShips.every(ship => ship.hits === ship.size);

            console.log('AI REPLY:', { shotId, result, allSunk });

            io.to(socket.id).emit('fire-reply', {
                id: shotId,
                result,
                sunkShipSize,
                gameOver: allSunk,
                winner: allSunk ? 'enemy' : null
            });

            if (allSunk) return;

            // NEW: Hard mode uses known locations, everything else uses existing logic
            let aiShot;
            if (room.aiDifficulty === 'hard' && room.hardModeTargets && room.hardModeIndex < room.hardModeTargets.length) {
                aiShot = room.hardModeTargets[room.hardModeIndex++];
                console.log('HARD MODE AI SHOT:', aiShot);
            } else {
                aiShot = getRandomAvailableShot(room.aiShotsTaken); // Existing function untouched
                console.log('AI SELECTED SHOT:', aiShot);
            }

            if (aiShot === null) return;

            room.aiShotsTaken.push(aiShot);

            setTimeout(() => {
                console.log('EMITTING OPPONENT-FIRE:', aiShot);
                io.to(socket.id).emit('opponent-fire', aiShot);
            }, 700);

            return;
        }

        socket.to(gameRoom).emit('opponent-fire', shotId);
});

    // --- CLEANUP ---
    socket.on('disconnecting', () => {
        if (waitingPlayer === socket) waitingPlayer = null;
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
            if (room !== socket.id) {
                socket.to(room).emit('player-disconnected');
                delete roomData[room]; // Clean up memory
            }
        });
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Server running on port 3000');
});