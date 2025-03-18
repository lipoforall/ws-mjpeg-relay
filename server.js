const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const http = require('http');

// Environment variables
const sourceWebSocket = process.env.SOURCE_WEBSOCKET || 'ws://10.242.176.200:8888/ws';
const hostIP = process.env.HOST_IP || '172.27.65.25';
const port = process.env.PORT || 10000;
const reconnectInterval = process.env.RECONNECT_INTERVAL || 5000; // 5 seconds

// Create express app
const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to expose configuration
app.get('/api/config', (req, res) => {
  res.json({
    sourceWebSocket,
    hostIP,
    port
  });
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'  // Explicitly set the path to /ws
});

// Connection to source WebSocket
let sourceWs = null;
let reconnectTimer = null;
let isConnected = false;
let connectedClients = new Set();

// Function to connect to source WebSocket
function connectToSource() {
  // Clear any existing reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  console.log(`Attempting to connect to source: ${sourceWebSocket}`);
  
  // Create new connection to source
  sourceWs = new WebSocket(sourceWebSocket);
  
  sourceWs.on('open', () => {
    console.log('Connected to source WebSocket');
    isConnected = true;
  });

  sourceWs.on('message', (data) => {
    // Broadcast the message to all connected clients
    connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });

  sourceWs.on('error', (error) => {
    console.error('Source WebSocket error:', error);
    isConnected = false;
  });

  sourceWs.on('close', () => {
    console.log('Source WebSocket closed, attempting to reconnect...');
    isConnected = false;
    
    // Schedule reconnection
    console.log(`Will attempt to reconnect in ${reconnectInterval}ms`);
    reconnectTimer = setTimeout(connectToSource, reconnectInterval);
  });
}

// Handle client connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  connectedClients.add(ws);
  
  // Send connection status to client
  ws.send(JSON.stringify({
    type: 'status',
    connected: isConnected
  }));
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log('Client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('Client WebSocket error:', error);
  });
});

// Start server
server.listen(port, () => {
  console.log(`Server listening at http://${hostIP}:${port}`);
  console.log(`WebSocket server running at ws://${hostIP}:${port}/ws`);
  console.log(`Relaying stream from: ${sourceWebSocket}`);
  
  // Connect to source WebSocket
  connectToSource();
});
