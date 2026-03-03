const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let waitingPlayer = null;
const roomData = {};

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
    socket.on('setup-game', (shipCount) => {
    const rooms = Array.from(socket.rooms);
    const gameRoom = rooms.find(r => r !== socket.id);
    if (gameRoom && roomData[gameRoom]) {
        roomData[gameRoom].shipCount = parseInt(shipCount);
        roomData[gameRoom].readyCount = 0;
        roomData[gameRoom].rematchCount = 0;

        io.in(gameRoom).emit('enter-placement-mode', parseInt(shipCount));
    }
});

    // --- PHASE 2: PLAYERS READY ---
    socket.on('player-ready', () => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);
        
        if(gameRoom && roomData[gameRoom]) {
            roomData[gameRoom].readyCount++;
            
            // If both players are ready, START!
            if (roomData[gameRoom].readyCount === 2) {
                io.in(gameRoom).emit('game-start');
            }
        }
    });

    socket.on('request-rematch', () => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);

        if (!gameRoom || !roomData[gameRoom]) return;

        roomData[gameRoom].rematchCount++;

        // When both players requested, reset and restart placement
        if (roomData[gameRoom].rematchCount === 2) {
            roomData[gameRoom].readyCount = 0;
            roomData[gameRoom].rematchCount = 0;

            const shipCount = roomData[gameRoom].shipCount ?? 5;
            io.in(gameRoom).emit('rematch-start', shipCount);
        } else {
            socket.to(gameRoom).emit('rematch-waiting'); // tell opponent "other player wants rematch"
            socket.emit('rematch-requested'); // tell requester "waiting..."
        }
});

    // --- PHASE 3: BATTLE ---
    socket.on('fire', (id) => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);
        if(gameRoom) socket.to(gameRoom).emit('opponent-fire', id);
    });

    socket.on('fire-reply', (data) => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);
        if(gameRoom) socket.to(gameRoom).emit('fire-reply', data);
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