import React, { useEffect, useRef, useState } from 'react';
import './App.css';

function App() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('disconnected');
  const [sourceInfo, setSourceInfo] = useState('');
  const [connectedSince, setConnectedSince] = useState('--');
  const [framesReceived, setFramesReceived] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRecordingEnabled, setIsRecordingEnabled] = useState(false);
  const [recordingInterval, setRecordingInterval] = useState(5);
  const [maxRecordings, setMaxRecordings] = useState(10);
  const [recordings, setRecordings] = useState([]);
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false);
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
      if (data) {
        setSourceInfo(data.sourceWebSocket);
        setIsRecordingEnabled(data.isRecordingEnabled);
        setRecordingInterval(data.recordingInterval);
        setMaxRecordings(data.maxRecordings);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
    }
  };

  const fetchRecordings = async () => {
    setIsLoadingRecordings(true);
    try {
      const response = await fetch('/api/recordings');
      const data = await response.json();
      setRecordings(data);
    } catch (error) {
      console.error('Error fetching recordings:', error);
    } finally {
      setIsLoadingRecordings(false);
    }
  };

  const deleteRecording = async (filename) => {
    try {
      const response = await fetch(`/api/recordings/${filename}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        fetchRecordings();
      } else {
        throw new Error('Failed to delete recording');
      }
    } catch (error) {
      console.error('Error deleting recording:', error);
      alert('Failed to delete recording. Please try again.');
    }
  };

  const updateConfig = async (updates) => {
    setIsUpdating(true);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update configuration');
      }
      
      // Update local state
      if (updates.sourceWebSocket) {
        setSourceInfo(updates.sourceWebSocket);
      }
      if (typeof updates.isRecordingEnabled === 'boolean') {
        setIsRecordingEnabled(updates.isRecordingEnabled);
      }
      if (updates.recordingInterval) {
        setRecordingInterval(updates.recordingInterval);
      }
      if (updates.maxRecordings) {
        setMaxRecordings(updates.maxRecordings);
      }
    } catch (error) {
      console.error('Error updating config:', error);
      alert('Failed to update configuration. Please try again.');
    } finally {
      setIsUpdating(false);
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
      setStatus('connecting');
      connectionTimeRef.current = new Date();
      updateConnectionTime();
    };

    wsRef.current.onmessage = (event) => {
      try {
        const jsonData = JSON.parse(event.data);
        if (jsonData.type === 'status') {
          console.log('Received status update:', jsonData);
          setStatus(jsonData.connected ? 'connected' : 'connecting');
          
          if (jsonData.sourceChanged) {
            console.log('Source WebSocket URL changed');
            setStatus('connecting');
            setFramesReceived(0);
            connectionTimeRef.current = null;
            setConnectedSince('--');
          }
          return;
        } else if (jsonData.type === 'recording_error') {
          console.error('Recording error:', jsonData.message);
          setIsRecordingEnabled(false);
          alert(`Recording failed: ${jsonData.message}`);
          return;
        }
      } catch (e) {
        // Not JSON, treat as binary data
      }

      if (event.data instanceof Blob) {
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
              }
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              setFramesReceived(prev => prev + 1);
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
      await updateConfig({ sourceWebSocket: newSourceUrl });
      setShowSettings(false);
      
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      setStatus('connecting');
      setFramesReceived(0);
      connectionTimeRef.current = null;
      setConnectedSince('--');
      
      connectWebSocket();
    } catch (error) {
      console.error('Error updating source URL:', error);
      alert('Failed to update source URL. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleRecording = async () => {
    try {
      await updateConfig({ isRecordingEnabled: !isRecordingEnabled });
      if (!isRecordingEnabled) {
        fetchRecordings();
      }
    } catch (error) {
      console.error('Error toggling recording:', error);
      alert('Failed to toggle recording. Please try again.');
    }
  };

  useEffect(() => {
    fetchSourceInfo();
    connectWebSocket();
    fetchRecordings();

    const interval = setInterval(updateConnectionTime, 1000);
    const recordingsInterval = setInterval(fetchRecordings, 5000);

    return () => {
      clearInterval(interval);
      clearInterval(recordingsInterval);
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
            setNewSourceUrl(sourceInfo);
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
            <div className="form-group">
              <label htmlFor="recordingInterval">Recording Interval (minutes):</label>
              <select
                id="recordingInterval"
                value={recordingInterval}
                onChange={(e) => updateConfig({ recordingInterval: parseInt(e.target.value) })}
                className="input-field"
              >
                <option value="1">1 minute</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="maxRecordings">Maximum Recordings:</label>
              <input
                type="number"
                id="maxRecordings"
                value={maxRecordings}
                onChange={(e) => updateConfig({ maxRecordings: parseInt(e.target.value) })}
                min="1"
                max="100"
                className="input-field"
              />
            </div>
            <div className="button-group">
              <button 
                className="button"
                onClick={updateSourceUrl}
                disabled={isUpdating || !newSourceUrl}
              >
                {isUpdating ? 'Updating...' : 'Update Source'}
              </button>
              <button 
                className={`button ${isRecordingEnabled ? 'recording-active' : ''}`}
                onClick={toggleRecording}
                disabled={isUpdating}
              >
                {isRecordingEnabled ? 'Stop Recording' : 'Start Recording'}
              </button>
            </div>
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
        <p><strong>Connected since:</strong> {connectedSince}</p>
        <p><strong>Frames received:</strong> {framesReceived}</p>
        <p><strong>Recording status:</strong> {isRecordingEnabled ? 'Active' : 'Inactive'}</p>
      </div>

      <div className="recordings-panel">
        <h3>Recordings</h3>
        {isLoadingRecordings ? (
          <p>Loading recordings...</p>
        ) : recordings.length > 0 ? (
          <div className="recordings-list">
            {recordings.map(recording => (
              <div key={recording.filename} className="recording-item">
                <div className="recording-info">
                  <span className="recording-name">{recording.filename}</span>
                  <span className="recording-size">{(recording.size / (1024 * 1024)).toFixed(2)} MB</span>
                  <span className="recording-date">{new Date(recording.created).toLocaleString()}</span>
                </div>
                <div className="recording-actions">
                  <a href={recording.path} download className="button">Download</a>
                  <button 
                    className="button delete"
                    onClick={() => deleteRecording(recording.filename)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No recordings available</p>
        )}
      </div>
    </div>
  );
}

export default App; 