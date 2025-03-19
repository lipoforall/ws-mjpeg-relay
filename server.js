const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

// Environment variables
let sourceWebSocket = process.env.SOURCE_WEBSOCKET || 'ws://10.242.176.200:8888/ws';
const hostIP = process.env.HOST_IP || '172.27.65.25';
const port = process.env.PORT || 10000;
const reconnectInterval = process.env.RECONNECT_INTERVAL || 5000; // 5 seconds
const MAX_FPS = process.env.MAX_FPS || 30; // Maximum frames per second
const FRAME_INTERVAL = 1000 / MAX_FPS; // Time between frames in milliseconds
const LOG_INTERVAL = 30000; // Log connection status every 30 seconds
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'recordings';
const MAX_RECORDINGS = process.env.MAX_RECORDINGS || 10; // Maximum number of recordings to keep

// Create recordings directory if it doesn't exist
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR);
}

// Create express app
const app = express();
const server = http.createServer(app);

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the React build directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve recordings directory
app.use('/recordings', express.static(RECORDINGS_DIR));

// Configuration state
let config = {
  sourceWebSocket,
  hostIP,
  port,
  isRecordingEnabled: false,
  recordingInterval: 5, // Default 5 minutes
  maxRecordings: MAX_RECORDINGS
};

// Recording state
let recordingProcess = null;
let currentRecordingFile = null;
let recordingStartTime = null;
let recordings = [];

// Function to get list of recordings
function getRecordings() {
  return new Promise((resolve, reject) => {
    fs.readdir(RECORDINGS_DIR, (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      
      const recordings = files
        .filter(file => file.endsWith('.mp4'))
        .map(file => {
          const stats = fs.statSync(path.join(RECORDINGS_DIR, file));
          return {
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            path: `/recordings/${file}`
          };
        })
        .sort((a, b) => b.created - a.created);
      
      resolve(recordings);
    });
  });
}

// Function to start recording
function startRecording() {
  if (recordingProcess) {
    console.log('Recording already in progress');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  currentRecordingFile = path.join(RECORDINGS_DIR, `recording_${timestamp}.mp4`);
  recordingStartTime = Date.now();

  console.log(`Starting recording to ${currentRecordingFile}`);
  
  try {
    // Check if FFmpeg is available
    const checkProcess = spawn('ffmpeg', ['-version']);
    let ffmpegVersion = '';
    
    checkProcess.stdout.on('data', (data) => {
      ffmpegVersion += data.toString();
    });
    
    checkProcess.on('error', (error) => {
      console.error('Error checking FFmpeg availability:', error.message);
      console.error('FFmpeg might not be installed in the Docker container');
      config.isRecordingEnabled = false;
      recordingStartTime = null;
      currentRecordingFile = null;
      
      // Notify connected clients about the recording failure
      connectedClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'recording_error',
            message: 'FFmpeg not available. Recording failed to start.'
          }));
        }
      });
      
      return;
    });
    
    checkProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`FFmpeg check failed with code ${code}`);
        config.isRecordingEnabled = false;
        recordingStartTime = null;
        currentRecordingFile = null;
        return;
      }
      
      console.log(`FFmpeg is available: ${ffmpegVersion.split('\n')[0]}`);
      
      // Start FFmpeg process
      recordingProcess = spawn('ffmpeg', [
        '-f', 'mjpeg', // Specify input format as MJPEG
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-y',
        currentRecordingFile
      ]);

      console.log('FFmpeg process started');

      recordingProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.log(`FFmpeg: ${output}`);
      });

      recordingProcess.on('error', (error) => {
        console.error('Error starting FFmpeg process:', error.message);
        config.isRecordingEnabled = false;
        recordingStartTime = null;
        currentRecordingFile = null;
      });

      recordingProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        
        // Check if file was created
        if (fs.existsSync(currentRecordingFile)) {
          const stats = fs.statSync(currentRecordingFile);
          console.log(`Recording file created: ${currentRecordingFile}, size: ${stats.size} bytes`);
        } else {
          console.error(`Recording file was not created: ${currentRecordingFile}`);
        }
        
        recordingProcess = null;
        currentRecordingFile = null;
        recordingStartTime = null;
      });
    });
  } catch (error) {
    console.error('Error when attempting to start recording:', error);
    config.isRecordingEnabled = false;
    recordingStartTime = null;
    currentRecordingFile = null;
  }
}

// Function to stop recording
function stopRecording() {
  if (recordingProcess) {
    recordingProcess.stdin.end();
    recordingProcess = null;
    currentRecordingFile = null;
    recordingStartTime = null;
  }
}

// Function to manage recordings (FIFO buffer)
async function manageRecordings() {
  try {
    const recordings = await getRecordings();
    if (recordings.length > config.maxRecordings) {
      // Delete oldest recordings
      const toDelete = recordings.slice(config.maxRecordings);
      for (const recording of toDelete) {
        fs.unlinkSync(path.join(RECORDINGS_DIR, recording.filename));
        console.log(`Deleted old recording: ${recording.filename}`);
      }
    }
  } catch (error) {
    console.error('Error managing recordings:', error);
  }
}

// API endpoint to expose configuration
app.get('/api/config', (req, res) => {
  res.json(config);
});

// API endpoint to update configuration
app.post('/api/config', (req, res) => {
  const { sourceWebSocket: newSourceWebSocket, isRecordingEnabled, recordingInterval, maxRecordings } = req.body;
  
  if (newSourceWebSocket) {
    config.sourceWebSocket = newSourceWebSocket;
    
    // Clear all buffers and reset state
    lastFrame = null;
    lastFrameTime = 0;
    frameDropCount = 0;
    isConnected = false;
    
    // Clear any pending reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    // Close existing source connection
    if (sourceWs) {
      sourceWs.close();
      sourceWs = null;
    }
    
    // Notify all clients about the source change
    connectedClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          connected: false,
          sourceChanged: true
        }));
      }
    });

    // Reconnect to the new source if we have clients or recording is enabled
    if (connectedClients.size > 0 || config.isRecordingEnabled) {
      connectToSource();
    }
  }

  if (typeof isRecordingEnabled === 'boolean') {
    config.isRecordingEnabled = isRecordingEnabled;
    if (isRecordingEnabled) {
      startRecording();
    } else {
      stopRecording();
    }
  }

  if (recordingInterval) {
    config.recordingInterval = parseInt(recordingInterval);
  }

  if (maxRecordings) {
    config.maxRecordings = parseInt(maxRecordings);
    manageRecordings();
  }

  res.json({ message: 'Configuration updated successfully' });
});

// API endpoint to get recordings list
app.get('/api/recordings', async (req, res) => {
  try {
    const recordings = await getRecordings();
    res.json(recordings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get recordings list' });
  }
});

// API endpoint to delete recording
app.delete('/api/recordings/:filename', (req, res) => {
  const { filename } = req.params;
  const filepath = path.join(RECORDINGS_DIR, filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Recording not found' });
  }
  
  try {
    fs.unlinkSync(filepath);
    res.json({ message: 'Recording deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete recording' });
  }
});

// Handle all other routes by serving the React app
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
let lastFrameTime = 0;
let lastLogTime = 0;
let pendingFrame = null;
let frameDropCount = 0;

// Function to get client IP
function getClientIP(ws) {
  const ip = ws._socket.remoteAddress;
  return ip.replace(/^.*:/, '');
}

// Function to log connection status (non-blocking)
function logConnectionStatus() {
  const now = Date.now();
  if (now - lastLogTime < LOG_INTERVAL) {
    return;
  }
  lastLogTime = now;
  
  setTimeout(() => {
    console.log('\n=== Connection Status ===');
    console.log(`Total connected clients: ${connectedClients.size}`);
    console.log('Connected client IPs:');
    connectedClients.forEach(ws => {
      console.log(`- ${getClientIP(ws)}`);
    });
    console.log(`Frame drop rate: ${frameDropCount} frames`);
    console.log(`Recording status: ${config.isRecordingEnabled ? 'Active' : 'Inactive'}`);
    if (config.isRecordingEnabled && recordingStartTime) {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      console.log(`Current recording duration: ${elapsed}s`);
    }
    console.log('=====================\n');
    frameDropCount = 0; // Reset counter
  }, 0);
}

// Function to broadcast frame to all clients with rate limiting
function broadcastFrame(frame) {
  const now = Date.now();
  
  // If we're receiving frames too fast, drop some
  if (now - lastFrameTime < FRAME_INTERVAL) {
    frameDropCount++;
    return;
  }
  
  lastFrameTime = now;
  lastFrame = frame;
  
  // Use a more efficient way to broadcast
  const clients = Array.from(connectedClients);
  const openClients = clients.filter(ws => ws.readyState === WebSocket.OPEN);
  
  if (openClients.length === 0 && !config.isRecordingEnabled) return;
  
  // Send frame to recording process if enabled
  if (config.isRecordingEnabled && recordingProcess) {
    try {
      recordingProcess.stdin.write(frame);
      // Log recording progress periodically
      if (recordingStartTime && now - recordingStartTime > 0 && (now - recordingStartTime) % 10000 < 1000) {
        const recordingDuration = Math.floor((now - recordingStartTime) / 1000);
        console.log(`Recording in progress: ${recordingDuration}s, frame size: ${frame.length} bytes`);
        
        // Check if the recording file exists and is growing
        if (currentRecordingFile && fs.existsSync(currentRecordingFile)) {
          const stats = fs.statSync(currentRecordingFile);
          console.log(`Current recording file size: ${stats.size} bytes`);
        }
      }
    } catch (error) {
      console.error('Error writing to recording process:', error);
      if (recordingProcess) {
        console.log('Attempting to restart recording due to write error');
        stopRecording();
        setTimeout(() => {
          if (config.isRecordingEnabled) {
            startRecording();
          }
        }, 1000);
      }
    }
  }
  
  // Use Promise.all for parallel sending
  Promise.all(openClients.map(ws => {
    return new Promise((resolve) => {
      try {
        ws.send(frame, { binary: true }, (error) => {
          if (error) {
            console.error('Error sending frame to client:', error);
          }
          resolve();
        });
      } catch (error) {
        console.error('Error sending frame to client:', error);
        resolve();
      }
    });
  })).catch(error => {
    console.error('Error in broadcast:', error);
  });
}

// Function to connect to source WebSocket
function connectToSource() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  // If there are no clients connected and recording is disabled, don't establish connection
  if (connectedClients.size === 0 && !config.isRecordingEnabled) {
    console.log('No clients connected and recording disabled, skipping connection to source');
    if (sourceWs) {
      sourceWs.close();
      sourceWs = null;
    }
    isConnected = false;
    return;
  }
  
  console.log(`Attempting to connect to source: ${config.sourceWebSocket}`);
  
  sourceWs = new WebSocket(config.sourceWebSocket, {
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024
  });
  
  sourceWs.on('open', () => {
    console.log('Connected to source WebSocket');
    isConnected = true;
    frameDropCount = 0;
    
    connectedClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          connected: true
        }));
      }
    });
  });

  let lastFrameTime = Date.now();
  
  sourceWs.on('message', (data) => {
    lastFrameTime = Date.now();
    isConnected = true;
    broadcastFrame(data);
  });

  sourceWs.on('error', (error) => {
    console.error('Source WebSocket error:', error);
    if (Date.now() - lastFrameTime > reconnectInterval) {
      isConnected = false;
    }
  });

  sourceWs.on('close', () => {
    console.log('Source WebSocket closed, attempting to reconnect...');
    
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
    
    // Reconnect if we have clients or recording is enabled
    if (connectedClients.size > 0 || config.isRecordingEnabled) {
      console.log(`Will attempt to reconnect in ${reconnectInterval}ms`);
      reconnectTimer = setTimeout(connectToSource, reconnectInterval);
    } else {
      console.log('No clients connected and recording disabled, skipping reconnection attempt');
      sourceWs = null;
      isConnected = false;
    }
  });
}

// Function to disconnect from source if no clients and recording disabled
function checkAndManageSourceConnection() {
  if (connectedClients.size === 0 && !config.isRecordingEnabled) {
    console.log('All clients disconnected and recording disabled, closing source WebSocket');
    if (sourceWs) {
      sourceWs.close();
      sourceWs = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    isConnected = false;
    lastFrame = null;
    lastFrameTime = 0;
    frameDropCount = 0;
  } else if (!sourceWs && (connectedClients.size > 0 || config.isRecordingEnabled)) {
    console.log('Clients connected or recording enabled, establishing connection');
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

  // Connect to source if this is the first client or recording is enabled
  if (isFirstClient || config.isRecordingEnabled) {
    console.log('First client connected or recording enabled, establishing source connection');
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
    checkAndManageSourceConnection();
  });
});

// Start server
server.listen(port, () => {
  console.log(`Server listening at http://${hostIP}:${port}`);
  console.log(`WebSocket server running at ws://${hostIP}:${port}/ws`);
  console.log(`Relaying stream from: ${config.sourceWebSocket}`);
  console.log(`Recordings directory: ${RECORDINGS_DIR}`);
  console.log(`Maximum recordings: ${config.maxRecordings}`);
  
  // Only connect to source if we have clients or recording is enabled
  console.log('Waiting for clients to connect or recording to be enabled');
  
  // Ensure we're disconnected from source at startup
  checkAndManageSourceConnection();
});
