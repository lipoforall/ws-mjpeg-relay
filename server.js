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

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to expose configuration
app.get('/api/config', (req, res) => {
  res.json({
    sourceWebSocket,
    hostIP,
    port
  });
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

// Connection to source WebSocket
let sourceWs = null;
let reconnectTimer = null;
let isConnected = false;
let connectedClients = new Set(); // Changed back to Set for better performance
let lastFrame = null; // Store the last received frame

// Function to get client IP
function getClientIP(ws) {
  const ip = ws._socket.remoteAddress;
  return ip.replace(/^.*:/, ''); // Remove IPv6 prefix if present
}

// Function to log connection status (non-blocking)
function logConnectionStatus() {
  // Use setTimeout to ensure logging doesn't block the main thread
  setTimeout(() => {
    console.log('\n=== Connection Status ===');
    console.log(`Total connected clients: ${connectedClients.size}`);
    console.log('Connected client IPs:');
    connectedClients.forEach(ws => {
      console.log(`- ${getClientIP(ws)}`);
    });
    console.log('=====================\n');
  }, 0);
}

// Function to broadcast frame to all clients
function broadcastFrame(frame) {
  const clients = Array.from(connectedClients); // Create a copy of the clients array
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(frame);
      } catch (error) {
        console.error('Error sending frame to client:', error);
      }
    }
  });
}

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
    
    // Notify all clients of connection status
    connectedClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          connected: true
        }));
      }
    });
  });

  sourceWs.on('message', (data) => {
    // Store the last frame
    lastFrame = data;
    
    // Broadcast the frame to all connected clients
    broadcastFrame(data);
  });

  sourceWs.on('error', (error) => {
    console.error('Source WebSocket error:', error);
    isConnected = false;
  });

  sourceWs.on('close', () => {
    console.log('Source WebSocket closed, attempting to reconnect...');
    isConnected = false;
    
    // Notify all clients of connection status
    connectedClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          connected: false
        }));
      }
    });
    
    // Schedule reconnection
    console.log(`Will attempt to reconnect in ${reconnectInterval}ms`);
    reconnectTimer = setTimeout(connectToSource, reconnectInterval);
  });
}

// Handle client connections
wss.on('connection', (ws) => {
  const clientIP = getClientIP(ws);
  console.log(`New client connected from IP: ${clientIP}`);
  
  // Store client connection
  connectedClients.add(ws);
  
  // Log current connection status (non-blocking)
  logConnectionStatus();
  
  // Send connection status to client
  ws.send(JSON.stringify({
    type: 'status',
    connected: isConnected
  }));

  // If we have a last frame, send it to the new client
  if (lastFrame && isConnected) {
    try {
      ws.send(lastFrame);
    } catch (error) {
      console.error('Error sending last frame to new client:', error);
    }
  }
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log(`Client disconnected from IP: ${clientIP}`);
    connectedClients.delete(ws);
    logConnectionStatus();
  });

  ws.on('error', (error) => {
    console.error(`Client WebSocket error from IP ${clientIP}:`, error);
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
