import React, { useEffect, useRef, useState } from 'react';
import './App.css';

function App() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('disconnected');
  const [sourceInfo, setSourceInfo] = useState('');
  const [resolution, setResolution] = useState('--');
  const [connectedSince, setConnectedSince] = useState('--');
  const [framesReceived, setFramesReceived] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const connectionTimeRef = useRef(null);

  const updateConnectionTime = () => {
    if (connectionTimeRef.current) {
      const now = new Date();
      const diff = now - connectionTimeRef.current;
      const seconds = Math.floor(diff / 1000) % 60;
      const minutes = Math.floor(diff / (1000 * 60)) % 60;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      setConnectedSince(`${hours}h ${minutes}m ${seconds}s`);
    }
  };

  const fetchSourceInfo = async () => {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      if (data && data.sourceWebSocket) {
        setSourceInfo(data.sourceWebSocket);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
    }
  };

  const connectWebSocket = () => {
    setStatus('connecting');
    setFramesReceived(0);

    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('WebSocket connection opened');
      setStatus('connecting'); // Keep as connecting until we get status from server
      connectionTimeRef.current = new Date();
      updateConnectionTime();
    };

    wsRef.current.onmessage = (event) => {
      try {
        const jsonData = JSON.parse(event.data);
        if (jsonData.type === 'status') {
          console.log('Received status update:', jsonData);
          setStatus(jsonData.connected ? 'connected' : 'connecting');
          
          // Handle source change notification
          if (jsonData.sourceChanged) {
            console.log('Source WebSocket URL changed');
            setStatus('connecting');
            setFramesReceived(0);
            connectionTimeRef.current = null;
            setConnectedSince('--');
          }
          return;
        }
      } catch (e) {
        // Not JSON, treat as binary data
      }

      if (event.data instanceof Blob) {
        // If we receive a frame, we know we're connected
        setStatus('connected');
        
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== img.width || canvas.height !== img.height) {
                canvas.width = img.width;
                canvas.height = img.height;
                setResolution(`${img.width} × ${img.height}`);
              }
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              setFramesReceived(prev => prev + 1);
              // Update connection time if not set already
              if (!connectionTimeRef.current) {
                connectionTimeRef.current = new Date();
              }
            }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(event.data);
      }
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket connection closed');
      setStatus('disconnected');
      connectionTimeRef.current = null;
      setConnectedSince('--');
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('disconnected');
      connectionTimeRef.current = null;
      setConnectedSince('--');
    };
  };

  const updateSourceUrl = async () => {
    if (!newSourceUrl) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourceWebSocket: newSourceUrl }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update source URL');
      }
      
      setSourceInfo(newSourceUrl);
      setShowSettings(false);
      
      // Close existing WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Reset state
      setStatus('connecting');
      setFramesReceived(0);
      connectionTimeRef.current = null;
      setConnectedSince('--');
      
      // Reconnect WebSocket to apply new source
      connectWebSocket();
    } catch (error) {
      console.error('Error updating source URL:', error);
      alert('Failed to update source URL. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    fetchSourceInfo();
    connectWebSocket();

    const interval = setInterval(updateConnectionTime, 1000);

    return () => {
      clearInterval(interval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="container">
      <div className="header">
        <h1>WebSocket Video Stream Viewer</h1>
        <button 
          className="settings-button"
          onClick={() => {
            setNewSourceUrl(sourceInfo); // Pre-fill with current source
            setShowSettings(!showSettings);
          }}
          title="Settings"
        >
          <i className="fas fa-cog"></i>
        </button>
      </div>
      
      {showSettings && (
        <div className="settings-panel">
          <h3>Stream Settings</h3>
          <div className="settings-form">
            <div className="form-group">
              <label htmlFor="sourceUrl">Source WebSocket URL:</label>
              <input
                type="text"
                id="sourceUrl"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                placeholder="ws://example.com:port/ws"
                className="input-field"
              />
            </div>
            <button 
              className="button"
              onClick={updateSourceUrl}
              disabled={isUpdating || !newSourceUrl}
            >
              {isUpdating ? 'Updating...' : 'Update Source'}
            </button>
          </div>
        </div>
      )}
      
      <div className="video-container">
        <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }} />
      </div>
      
      <div className="controls">
        <div className="status-container">
          <div className={`status-led ${status}`} />
          <span className="status-text">
            {status === 'connected' ? 'Connected' :
             status === 'connecting' ? 'Connecting' :
             'Disconnected'}
          </span>
        </div>
        <div>
          <button className="button" onClick={connectWebSocket}>Reconnect</button>
        </div>
      </div>
      
      <div className="info-panel">
        <h3>Stream Information</h3>
        <p><strong>Source:</strong> {sourceInfo}</p>
        <p><strong>Resolution:</strong> {resolution}</p>
        <p><strong>Connected since:</strong> {connectedSince}</p>
        <p><strong>Frames received:</strong> {framesReceived}</p>
      </div>
    </div>
  );
}

export default App; 