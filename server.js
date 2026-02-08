const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let waitingPlayer = null;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    if (waitingPlayer) {
        // Match matchmaking
        const roomName = `${waitingPlayer.id}#${socket.id}`;
        socket.join(roomName);
        waitingPlayer.join(roomName);

        // Assign Roles
        io.to(waitingPlayer.id).emit('player-number', 0); // Player 1
        io.to(socket.id).emit('player-number', 1);       // Player 2
        
        // Start Game
        io.to(roomName).emit('game-start');
        waitingPlayer = null;
    } else {
        waitingPlayer = socket;
    }

    // Fire Logic
    socket.on('fire', (id) => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);
        if(gameRoom) {
            socket.to(gameRoom).emit('opponent-fire', id);
        }
    });

    // Reply Logic
    socket.on('fire-reply', (data) => {
        const rooms = Array.from(socket.rooms);
        const gameRoom = rooms.find(r => r !== socket.id);
        if(gameRoom) {
            socket.to(gameRoom).emit('fire-reply', data);
        }
    });

    // --- CRITICAL FIX: Handle Disconnects Correctly ---
    socket.on('disconnecting', () => {
        // If the WAITING player leaves, just clear the queue
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        } else {
            // If an ACTIVE player leaves, notify ONLY their opponent
            const rooms = Array.from(socket.rooms);
            rooms.forEach(room => {
                if (room !== socket.id) {
                    socket.to(room).emit('player-disconnected');
                }
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Server running on port 3000');
});