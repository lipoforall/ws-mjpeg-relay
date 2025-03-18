const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const http = require('http');

// Environment variables
let sourceWebSocket = process.env.SOURCE_WEBSOCKET || 'ws://10.242.176.200:8888/ws';
const hostIP = process.env.HOST_IP || '172.27.65.25';
const port = process.env.PORT || 10000;
const reconnectInterval = process.env.RECONNECT_INTERVAL || 5000; // 5 seconds

// Create express app
const app = express();
const server = http.createServer(app);

// Middleware to parse JSON bodies
app.use(express.json());

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

// API endpoint to update configuration
app.post('/api/config', (req, res) => {
  const { sourceWebSocket: newSourceWebSocket } = req.body;
  
  if (!newSourceWebSocket) {
    return res.status(400).json({ error: 'Source WebSocket URL is required' });
  }

  // Update the source WebSocket URL
  sourceWebSocket = newSourceWebSocket;
  
  // Clear the last frame buffer
  lastFrame = null;
  
  // Reconnect to the new source
  if (sourceWs) {
    sourceWs.close();
  }
  connectToSource();

  res.json({ message: 'Configuration updated successfully' });
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
let connectedClients = new Set();
let lastFrame = null;

// Function to get client IP
function getClientIP(ws) {
  const ip = ws._socket.remoteAddress;
  return ip.replace(/^.*:/, '');
}

// Function to log connection status (non-blocking)
function logConnectionStatus() {
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
  const clients = Array.from(connectedClients);
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  // If there are no clients connected, don't establish connection
  if (connectedClients.size === 0) {
    console.log('No clients connected, skipping connection to source');
    return;
  }
  
  console.log(`Attempting to connect to source: ${sourceWebSocket}`);
  
  sourceWs = new WebSocket(sourceWebSocket);
  
  sourceWs.on('open', () => {
    console.log('Connected to source WebSocket');
    isConnected = true;
    
    connectedClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          connected: true
        }));
      }
    });
  });

  // Track when the last frame was received
  let lastFrameTime = Date.now();
  
  sourceWs.on('message', (data) => {
    lastFrame = data;
    lastFrameTime = Date.now();
    isConnected = true; // Ensure connection status is true when frames are received
    broadcastFrame(data);
  });

  sourceWs.on('error', (error) => {
    console.error('Source WebSocket error:', error);
    // Don't set isConnected to false if we're still receiving frames
    if (Date.now() - lastFrameTime > reconnectInterval) {
      isConnected = false;
    }
  });

  sourceWs.on('close', () => {
    console.log('Source WebSocket closed, attempting to reconnect...');
    
    // Only set isConnected to false if we haven't received frames recently
    if (Date.now() - lastFrameTime > reconnectInterval) {
      isConnected = false;
      
      connectedClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'status',
            connected: false
          }));
        }
      });
    }
    
    // Only reconnect if we have clients
    if (connectedClients.size > 0) {
      console.log(`Will attempt to reconnect in ${reconnectInterval}ms`);
      reconnectTimer = setTimeout(connectToSource, reconnectInterval);
    } else {
      console.log('No clients connected, skipping reconnection attempt');
    }
  });
}

// Function to disconnect from source if no clients
function checkAndManageSourceConnection() {
  if (connectedClients.size === 0) {
    console.log('All clients disconnected, closing source WebSocket to reduce traffic');
    if (sourceWs) {
      sourceWs.close();
      sourceWs = null;
    }
    isConnected = false;
  } else if (!sourceWs && connectedClients.size > 0) {
    console.log('Clients connected but no source connection, establishing connection');
    connectToSource();
  }
}

// Handle client connections
wss.on('connection', (ws) => {
  const clientIP = getClientIP(ws);
  console.log(`New client connected from IP: ${clientIP}`);
  
  const isFirstClient = connectedClients.size === 0;
  connectedClients.add(ws);
  logConnectionStatus();
  
  ws.send(JSON.stringify({
    type: 'status',
    connected: isConnected
  }));

  // Connect to source if this is the first client
  if (isFirstClient) {
    console.log('First client connected, establishing source connection');
    connectToSource();
  } else if (lastFrame && isConnected) {
    try {
      ws.send(lastFrame);
    } catch (error) {
      console.error('Error sending last frame to new client:', error);
    }
  }
  
  ws.on('close', () => {
    console.log(`Client disconnected from IP: ${clientIP}`);
    connectedClients.delete(ws);
    logConnectionStatus();
    
    // Check if we need to disconnect from source
    checkAndManageSourceConnection();
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
  
  // Only connect to source if we have clients (which we don't at startup)
  console.log('Waiting for clients to connect before establishing source connection');
});
