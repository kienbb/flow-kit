/**
 * Session Management Module
 * Handles bearer tokens, project IDs, and client identification
 */

const FLOW_URL = 'https://labs.google/fx/tools/flow';

let sessionData = {
  bearerToken: null,
  projectId: null,
  clientId: null,
  lastSync: 0,
  syncError: null,
  isConnected: false
};

let FLOW_CONFIG = null;

/**
 * Load flow configuration from JSON file
 */
async function loadFlowConfig() {
  if (FLOW_CONFIG) return FLOW_CONFIG;
  
  try {
    const configUrl = chrome.runtime.getURL('flow-config.json');
    const response = await fetch(configUrl);
    FLOW_CONFIG = await response.json();
    console.log('[NanoBanana] ✅ flow-config.json loaded, version:', FLOW_CONFIG.version);
  } catch (error) {
    console.warn('[NanoBanana] ⚠️ Failed to load flow-config.json:', error.message);
    // Fallback config
    FLOW_CONFIG = {
      googleApi: {
        base: 'https://aisandbox-pa.googleapis.com/v1',
        generateImage: 'projects/{projectId}/flowMedia:batchGenerateImages',
        uploadImage: 'flow/uploadImage',
        getMedia: 'media/{mediaId}'
      },
      imageModels: {
        'nano banana pro': 'GEM_PIX_2'
      },
      imageAspectRatios: {
        '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
        '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
        '1:1': 'IMAGE_ASPECT_RATIO_SQUARE'
      },
      defaultSettings: {
        model: 'GEM_PIX_2',
        aspectRatio: 'IMAGE_ASPECT_RATIO_SQUARE',
        imageCount: 4
      }
    };
  }
  
  return FLOW_CONFIG;
}

/**
 * Initialize session on startup
 */
async function initSession() {
  await loadFlowConfig();
  
  // Load saved session data
  const stored = await chrome.storage.local.get([
    'nanoBananaClientId',
    'nanoBananaProjectId',
    'nanoBananaToken'
  ]);
  
  if (stored.nanoBananaClientId) {
    sessionData.clientId = stored.nanoBananaClientId;
  } else {
    // Generate new client ID
    sessionData.clientId = 'nb_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    await chrome.storage.local.set({ nanoBananaClientId: sessionData.clientId });
  }
  
  if (stored.nanoBananaProjectId) {
    sessionData.projectId = stored.nanoBananaProjectId;
  }
  
  if (stored.nanoBananaToken) {
    sessionData.bearerToken = stored.nanoBananaToken;
  }
  
  console.log('[NanoBanana] Session initialized:', {
    clientId: sessionData.clientId.substring(0, 8) + '...',
    hasToken: !!sessionData.bearerToken,
    projectId: sessionData.projectId ? sessionData.projectId.substring(0, 8) + '...' : null
  });
}

/**
 * Update bearer token
 */
async function updateBearerToken(token, projectId = null) {
  sessionData.bearerToken = token;
  sessionData.isConnected = true;
  sessionData.lastSync = Date.now();
  if (projectId) {
    sessionData.projectId = projectId;
  }
  
  // Save to storage
  await chrome.storage.local.set({
    nanoBananaToken: token,
    nanoBananaTokenTime: Date.now()
  });
  
  if (projectId) {
    await chrome.storage.local.set({ nanoBananaProjectId: projectId });
  }
  
  console.log('[NanoBanana] Token updated');
}

/**
 * Update project ID
 */
async function updateProjectId(projectId) {
  sessionData.projectId = projectId;
  await chrome.storage.local.set({ nanoBananaProjectId: projectId });
  console.log('[NanoBanana] Project ID updated:', projectId.substring(0, 8) + '...');
}

/**
 * Get current session status
 */
function getSessionStatus() {
  return {
    ...sessionData,
    tokenAge: sessionData.bearerToken ? Date.now() - (sessionData.lastSync || 0) : null
  };
}

/**
 * Clear all session data
 */
async function clearSession() {
  sessionData.bearerToken = null;
  sessionData.projectId = null;
  sessionData.lastSync = 0;
  sessionData.syncError = null;
  sessionData.isConnected = false;
  
  await chrome.storage.local.remove([
    'nanoBananaToken',
    'nanoBananaProjectId',
    'nanoBananaTokenTime'
  ]);
  
  console.log('[NanoBanana] Session cleared');
}

/**
 * Find Google Flow tab
 */
async function findFlowTab() {
  const tabs = await chrome.tabs.query({});
  const flowTabs = tabs.filter(tab => tab.url && tab.url.includes('labs.google'));
  
  if (flowTabs.length === 0) return null;
  
  // Prefer tab with active project
  const projectTab = flowTabs.find(tab => tab.url.includes('/tools/flow/project/'));
  return projectTab || flowTabs[0];
}

/**
 * Ensure Flow tab is open
 */
async function ensureFlowTab() {
  const tab = await findFlowTab();
  if (tab) return tab;
  
  // Open new tab
  const newTab = await chrome.tabs.create({ url: FLOW_URL });
  await waitForTabLoad(newTab.id);
  return newTab;
}

/**
 * Wait for tab to finish loading
 */
function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} load timeout`));
    }, timeout);
    
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Export for use in other modules
export {
  sessionData,
  FLOW_CONFIG,
  loadFlowConfig,
  initSession,
  updateBearerToken,
  updateProjectId,
  getSessionStatus,
  clearSession,
  findFlowTab,
  ensureFlowTab,
  waitForTabLoad
};
