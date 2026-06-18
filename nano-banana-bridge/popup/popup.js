/**
 * Popup Script
 * Handles UI interactions and status updates
 */

document.addEventListener('DOMContentLoaded', async () => {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('version').textContent = 'v' + manifest.version;
  document.getElementById('ext-id').textContent = chrome.runtime.id;

  // Get UI elements
  const dotAuth = document.getElementById('dot-auth');
  const statusAuth = document.getElementById('status-auth');
  const dotProject = document.getElementById('dot-project');
  const statusProject = document.getElementById('status-project');
  const infoProjectId = document.getElementById('info-project-id');
  const infoLastSync = document.getElementById('info-last-sync');
  const infoClientId = document.getElementById('info-client-id');

  // Load initial status
  await updateStatus();

  // Button handlers
  document.getElementById('btn-open-flow').addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'ENSURE_FLOW_TAB' });
      if (response.success) {
        window.close();
      } else {
        alert('Failed to open Google Flow: ' + response.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  });

  document.getElementById('btn-check-status').addEventListener('click', async () => {
    const btn = document.getElementById('btn-check-status');
    btn.textContent = '⏳ Checking...';
    btn.disabled = true;
    
    await updateStatus();
    
    btn.textContent = '🔄 Check Status';
    btn.disabled = false;
  });

  document.getElementById('btn-reload').addEventListener('click', async () => {
    const btn = document.getElementById('btn-reload');
    btn.textContent = '⏳ Reloading...';
    btn.disabled = true;
    
    try {
      await chrome.runtime.sendMessage({ action: 'RELOAD_EXTENSION' });
    } catch (error) {
      // Extension will reload, this is expected
    }
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear the session?')) return;
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'CLEAR_SESSION' });
      if (response.success) {
        await updateStatus();
        alert('Session cleared');
      } else {
        alert('Failed: ' + response.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  });

  /**
   * Update status display
   */
  async function updateStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
      
      if (!response.success) {
        setDisconnected();
        return;
      }

      const status = response.data;

      // Auth status
      if (status.bearerToken) {
        setStatus(dotAuth, statusAuth, 'green', 'Authenticated');
      } else {
        setStatus(dotAuth, statusAuth, 'yellow', 'No token');
      }

      // Project status
      if (status.projectId) {
        setStatus(dotProject, statusProject, 'green', 'Active');
        infoProjectId.textContent = status.projectId.substring(0, 12) + '...';
      } else {
        setStatus(dotProject, statusProject, 'gray', 'Not set');
        infoProjectId.textContent = '—';
      }

      // Last sync
      if (status.lastSync) {
        infoLastSync.textContent = formatTimeAgo(status.lastSync);
      } else {
        infoLastSync.textContent = '—';
      }

      // Client ID
      if (status.clientId) {
        infoClientId.textContent = status.clientId.substring(0, 8) + '...';
      } else {
        infoClientId.textContent = '—';
      }

    } catch (error) {
      console.error('Failed to get status:', error);
      setDisconnected();
    }
  }

  /**
   * Set status indicator
   */
  function setStatus(dot, label, color, text) {
    dot.className = 'dot ' + color;
    label.textContent = text;
  }

  /**
   * Set all to disconnected
   */
  function setDisconnected() {
    setStatus(dotAuth, statusAuth, 'gray', 'Unknown');
    setStatus(dotProject, statusProject, 'gray', 'Unknown');
  }

  /**
   * Format timestamp to relative time
   */
  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return seconds + 's ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    return Math.floor(seconds / 3600) + 'h ago';
  }
});
