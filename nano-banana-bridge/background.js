/**
 * Background Service Worker
 * Main orchestrator for Nano Banana Bridge
 */

import { 
  sessionData, 
  initSession, 
  updateBearerToken, 
  updateProjectId,
  clearSession,
  findFlowTab,
  ensureFlowTab,
  getSessionStatus
} from './modules/session.js';

import {
  generateImage,
  downloadImage
} from './modules/image-gen.js';

import {
  initAPIServer
} from './modules/api-server.js';

const TOKEN_CAPTURE_URLS = [
  '*://labs.google/*',
  '*://aisandbox-pa.googleapis.com/*'
];

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization');
    if (auth?.value?.startsWith('Bearer ') && sessionData.bearerToken !== auth.value) {
      const projectMatch = details.url.match(/projects\/([^/]+)\//);
      const projectId = projectMatch ? projectMatch[1] : sessionData.projectId;
      console.log('[NanoBanana] Bearer token captured from request');
      updateBearerToken(auth.value, projectId).catch(() => {});
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: TOKEN_CAPTURE_URLS },
  ['requestHeaders', 'extraHeaders']
);

// Initialize extension
chrome.runtime.onStartup.addListener(initExtension);
chrome.runtime.onInstalled.addListener(initExtension);

let extensionInitialized = false;

async function initExtension() {
  if (extensionInitialized) return;
  extensionInitialized = true;

  console.log('[NanoBanana] Extension initializing...');

  await initSession();
  initAPIServer();

  console.log('[NanoBanana] Extension initialized - API mode');
  console.log('[NanoBanana] Extension ID:', chrome.runtime.id);
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action && message.action.startsWith('API_')) {
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ success: false, error: error.message }));

  return true; // Keep channel open for async
});

/**
 * Handle incoming messages
 */
async function handleMessage(message, sender) {
  console.log('[NanoBanana] Received message:', message.action);
  
  switch (message.action) {
    case 'UPDATE_PROJECT':
      return await handleUpdateProject(message);
      
    case 'GENERATE_IMAGE':
      return await handleGenerateImage(message);
      
    case 'DOWNLOAD_IMAGE':
      return await handleDownloadImage(message);
      
    case 'GET_STATUS':
      return await handleGetStatus();
      
    case 'CLEAR_SESSION':
      return await handleClearSession();
      
    case 'RELOAD_EXTENSION':
      return await handleReload();
      
    case 'FIND_FLOW_TAB':
      return await handleFindFlowTab();
      
    case 'ENSURE_FLOW_TAB':
      return await handleEnsureFlowTab();
      
    default:
      return { success: false, error: 'Unknown action: ' + message.action };
  }
}

/**
 * Handle project update
 */
async function handleUpdateProject(message) {
  try {
    if (message.projectId) {
      await updateProjectId(message.projectId);
    }
    
    return {
      success: true,
      projectId: sessionData.projectId
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle image generation request
 */
async function handleGenerateImage(message) {
  try {
    const result = await generateImage({
      prompt: message.prompt,
      aspectRatio: message.aspectRatio || '1:1',
      count: message.count || 4,
      projectName: message.projectName,
      style: message.style
    });
    
    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle image download request
 */
async function handleDownloadImage(message) {
  try {
    const result = await downloadImage(message.mediaId);
    
    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle get status request
 */
async function handleGetStatus() {
  return {
    success: true,
    data: getSessionStatus()
  };
}

/**
 * Handle clear session request
 */
async function handleClearSession() {
  try {
    await clearSession();
    return { success: true, message: 'Session cleared' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle reload extension request
 */
async function handleReload() {
  setTimeout(() => chrome.runtime.reload(), 500);
  return { success: true, message: 'Reloading...' };
}

/**
 * Handle find Flow tab request
 */
async function handleFindFlowTab() {
  const tab = await findFlowTab();
  return {
    success: true,
    data: {
      found: !!tab,
      tabId: tab?.id,
      url: tab?.url
    }
  };
}

/**
 * Handle ensure Flow tab request
 */
async function handleEnsureFlowTab() {
  try {
    const tab = await ensureFlowTab();
    return {
      success: true,
      data: {
        tabId: tab.id,
        url: tab.url
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('labs.google')) {
    const match = tab.url.match(/\/project\/([a-zA-Z0-9_-]+)/);
    if (match) updateProjectId(match[1]).catch(() => {});
  }
});

// Initialize immediately
initExtension();
