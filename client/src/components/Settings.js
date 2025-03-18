import React, { useState, useEffect } from 'react';
import './Settings.css';

function Settings({ onClose }) {
  const [streamAddress, setStreamAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Fetch current settings when component mounts
    fetch('/api/config')
      .then(response => response.json())
      .then(data => {
        if (data && data.sourceWebSocket) {
          setStreamAddress(data.sourceWebSocket);
        }
      })
      .catch(error => {
        console.error('Error fetching config:', error);
        setMessage('Error loading settings');
      });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceWebSocket: streamAddress
        })
      });

      if (response.ok) {
        setMessage('Settings saved successfully');
        // Wait a bit before closing to show the success message
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setMessage('Error saving settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('Error saving settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <h2>Stream Settings</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="streamAddress">Stream Address:</label>
            <input
              type="text"
              id="streamAddress"
              value={streamAddress}
              onChange={(e) => setStreamAddress(e.target.value)}
              placeholder="ws://example.com/ws"
              required
            />
          </div>
          {message && <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>{message}</div>}
          <div className="button-group">
            <button type="button" onClick={onClose} className="button secondary">Cancel</button>
            <button type="submit" className="button primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Settings; 