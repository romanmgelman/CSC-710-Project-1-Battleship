# CSC-710-Project-1-Battleship
## How the Game Works

### 1. Host Starts Server
The game server is started using **Node.js**, which handles communication between both players and manages the overall game state.

### 2. Players Connect
One player hosts the game by running the server.  
The second player connects to the game using the **host machine’s IP address** through their web browser on the same network.

### 3. Ship Placement
Both players place their ships on their individual game boards before the match begins.

### 4. Gameplay
Players take turns attacking coordinates on the opponent’s grid.  
The server processes each move and sends updates to both players.

### 5. Win Condition
When all ships belonging to one player are sunk, the game ends and a winner is declared.

### 6. Rematch
After the match finishes, players can start a new game using the **Play Again** feature without needing to restart the server.

## Running the Project
To run, clone the repository, open a terminal in the project directory and run:
```npm i```
then finally
```node server.js```

Then open a browser and navigate to:

```http://localhost:3000```

Next, connect from another computer on the same network to:

```http://<MAIN COMPUTER'S IP>:3000```

To start the game.
