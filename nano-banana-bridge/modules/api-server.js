/**
 * API Server Module
 * Exposes Flow Image Generation as HTTP API via Chrome Extension
 * 
 * Usage:
 * 1. From web page: Use chrome.runtime.sendMessage(EXTENSION_ID, {...})
 * 2. From fetch: Access api.html page with postMessage
 * 3. From external: Use externally_connectable in manifest
 */

import {
  sessionData,
  loadFlowConfig,
  updateProjectId,
  clearSession
} from './session.js';

import {
  generateImage,
  downloadImage
} from './image-gen.js';

// API Configuration
const API_VERSION = 'v1';

// Request queue for batch processing
const requestQueue = [];
let isProcessingQueue = false;

/**
 * Initialize API server
 */
function initAPIServer() {
  console.log('[NanoBanana API] Initializing API server...');
  
  // Handle external messages (from web pages with extension ID)
  chrome.runtime.onMessageExternal.addListener(handleExternalMessage);
  
  // Handle internal messages (from content scripts, popup)
  chrome.runtime.onMessage.addListener(handleInternalMessage);
  
  console.log('[NanoBanana API] API server ready');
}

/**
 * Handle external messages from web pages
 */
function handleExternalMessage(request, sender, sendResponse) {
  console.log('[NanoBanana API] External request:', request.action);
  
  // Validate request
  if (!request.action) {
    sendResponse({ error: 'Missing action field' });
    return true;
  }
  
  // Process request
  processAPIRequest(request)
    .then(result => sendResponse(result))
    .catch(error => sendResponse({ error: error.message }));
  
  return true; // Keep channel open for async
}

/**
 * Handle internal messages
 */
function handleInternalMessage(request, sender, sendResponse) {
  // Only handle API-related messages
  if (!request.action || !request.action.startsWith('API_')) {
    return false; // Let other handlers process
  }
  
  const apiRequest = {
    ...request,
    action: request.action.replace('API_', '')
  };
  
  processAPIRequest(apiRequest)
    .then(result => sendResponse(result))
    .catch(error => sendResponse({ error: error.message }));
  
  return true;
}

/**
 * Process API request
 */
async function processAPIRequest(request) {
  const { action, ...params } = request;
  
  switch (action) {
    // Image Generation
    case 'generate':
      return await apiGenerateImage(params);
    
    case 'generate-batch':
      return await apiGenerateBatch(params);
    
    // Status & Info
    case 'status':
      return await apiGetStatus();
    
    case 'models':
      return apiGetModels();
    
    case 'aspect-ratios':
      return apiGetAspectRatios();
    
    // Downloads
    case 'download':
      return await apiDownloadImage(params);
    
    case 'download-url':
      return await apiGetDownloadUrl(params);
    
    // Session Management
    case 'session':
      return apiGetSession();
    
    case 'set-project':
      return await apiSetProject(params);
    
    case 'clear-session':
      return await apiClearSession();
    
    // Queue Management
    case 'queue':
      return apiGetQueue();
    
    case 'queue-clear':
      return apiClearQueue();
    
    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ==================== API ENDPOINTS ====================

/**
 * POST /api/v1/generate
 * Generate images with specified parameters
 * 
 * Request:
 * {
 *   prompt: string (required)
 *   aspectRatio: '1:1' | '16:9' | '9:16' (default: '1:1')
 *   count: number 1-4 (default: 4)
 *   model: 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana' (default: 'nano-banana-pro')
 *   seed: number (optional)
 *   projectId: string (optional)
 * }
 */
async function apiGenerateImage(params) {
  try {
    const {
      prompt,
      aspectRatio = '1:1',
      count = 4,
      model = 'nano-banana-pro',
      seed = null,
      projectId = null
    } = params;

    // Validate required fields
    if (!prompt) {
      return { error: 'Missing required field: prompt' };
    }

    // Ensure session
    if (!sessionData?.bearerToken) {
      return {
        error: 'Not authenticated. Please open Google Flow and login.',
        code: 'AUTH_REQUIRED'
      };
    }

    // Allow caller to override the active project for this request
    const targetProjectId = projectId || sessionData.projectId;
    if (!targetProjectId) {
      return {
        error: 'No project ID. Please set project or open a Flow project.',
        code: 'PROJECT_REQUIRED'
      };
    }
    if (projectId && projectId !== sessionData.projectId) {
      await updateProjectId(projectId);
    }

    // Delegate to the real generation flow (runs reCAPTCHA + authenticated
    // fetch inside the Flow tab; batchGenerateImages is synchronous).
    const result = await generateImage({ prompt, aspectRatio, count, model, seed });

    return {
      success: true,
      data: {
        mediaIds: result.mediaIds,
        workflowIds: result.workflowIds,
        images: result.images,
        prompt,
        aspectRatio,
        model,
        projectId: targetProjectId,
        timestamp: result.timestamp
      }
    };

  } catch (error) {
    console.error('[NanoBanana API] Generate failed:', error);
    const msg = error.message || String(error);
    let code = 'INTERNAL_ERROR';
    if (/bearer token/i.test(msg)) code = 'AUTH_REQUIRED';
    else if (/project id/i.test(msg)) code = 'PROJECT_REQUIRED';
    else if (/API Error (\d+)/.test(msg)) code = 'HTTP_' + RegExp.$1;
    return { error: msg, code };
  }
}

/**
 * POST /api/v1/generate-batch
 * Generate multiple images in batch
 * 
 * Request:
 * {
 *   prompts: string[] (required)
 *   aspectRatio: string (default: '1:1')
 *   count: number (default: 4)
 *   model: string (default: 'nano-banana-pro')
 * }
 */
async function apiGenerateBatch(params) {
  try {
    const { prompts, ...options } = params;
    
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return { error: 'Missing or invalid prompts array' };
    }
    
    const results = [];
    
    for (let i = 0; i < prompts.length; i++) {
      const result = await apiGenerateImage({
        prompt: prompts[i],
        ...options
      });
      
      results.push({
        index: i,
        prompt: prompts[i],
        ...result
      });
      
      // Small delay between requests
      if (i < prompts.length - 1) {
        await delay(1500);
      }
    }
    
    return {
      success: true,
      data: {
        results,
        total: prompts.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    };
    
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * GET /api/v1/status
 * Get current extension status
 */
async function apiGetStatus() {
  return {
    success: true,
    data: {
      authenticated: !!sessionData?.bearerToken,
      projectId: sessionData?.projectId,
      projectSet: !!sessionData?.projectId,
      lastSync: sessionData?.lastSync,
      isConnected: sessionData?.isConnected || false,
      version: chrome.runtime.getManifest().version,
      timestamp: Date.now()
    }
  };
}

/**
 * GET /api/v1/models
 * Get available image models
 */
function apiGetModels() {
  return {
    success: true,
    data: {
      models: [
        {
          id: 'nano-banana-pro',
          name: 'Nano Banana Pro',
          apiId: 'GEM_PIX_2',
          description: 'Highest quality image generation',
          maxCount: 4,
          recommended: true
        },
        {
          id: 'nano-banana-2',
          name: 'Nano Banana 2',
          apiId: 'NARWHAL',
          description: 'Balanced quality and speed',
          maxCount: 4
        },
        {
          id: 'nano-banana',
          name: 'Nano Banana',
          apiId: 'GEM_PIX_0',
          description: 'Fast generation',
          maxCount: 4
        }
      ]
    }
  };
}

/**
 * GET /api/v1/aspect-ratios
 * Get available aspect ratios
 */
function apiGetAspectRatios() {
  return {
    success: true,
    data: {
      ratios: [
        { id: '1:1', name: 'Square', constant: 'IMAGE_ASPECT_RATIO_SQUARE' },
        { id: '16:9', name: 'Landscape', constant: 'IMAGE_ASPECT_RATIO_LANDSCAPE' },
        { id: '9:16', name: 'Portrait', constant: 'IMAGE_ASPECT_RATIO_PORTRAIT' }
      ]
    }
  };
}

/**
 * POST /api/v1/download
 * Download image by media ID
 * 
 * Request:
 * {
 *   mediaId: string (required)
 *   format: 'base64' | 'url' (default: 'base64')
 * }
 */
async function apiDownloadImage(params) {
  try {
    const { mediaId, format = 'base64' } = params;

    if (!mediaId) {
      return { error: 'Missing mediaId' };
    }

    if (!sessionData?.bearerToken) {
      return { error: 'Not authenticated', code: 'AUTH_REQUIRED' };
    }

    if (format === 'url') {
      const config = await loadFlowConfig();
      const idForUrl = mediaId.includes('/')
        ? mediaId
        : config.googleApi.getMedia.replace('{mediaId}', mediaId);
      const url = idForUrl.startsWith('http')
        ? idForUrl
        : `${config.googleApi.base}/${idForUrl.replace(/^\/+/, '')}`;
      return {
        success: true,
        data: { url, headers: { Authorization: sessionData.bearerToken } }
      };
    }

    const result = await downloadImage(mediaId);
    return { success: true, data: result };

  } catch (error) {
    return { error: error.message };
  }
}

/**
 * POST /api/v1/download-url
 * Get download URL for media
 */
async function apiGetDownloadUrl(params) {
  try {
    const { mediaId } = params;
    
    if (!mediaId) {
      return { error: 'Missing mediaId' };
    }
    
    if (!sessionData?.bearerToken) {
      return { error: 'Not authenticated', code: 'AUTH_REQUIRED' };
    }
    
    const config = await loadFlowConfig();
    const url = `${config.googleApi.base}/${config.googleApi.getMedia.replace('{mediaId}', mediaId)}`;
    
    return {
      success: true,
      data: {
        mediaId,
        url,
        authorization: sessionData.bearerToken
      }
    };
    
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * GET /api/v1/session
 * Get current session info
 */
function apiGetSession() {
  return {
    success: true,
    data: {
      clientId: sessionData?.clientId,
      hasToken: !!sessionData?.bearerToken,
      projectId: sessionData?.projectId,
      lastSync: sessionData?.lastSync,
      isConnected: sessionData?.isConnected || false
    }
  };
}

/**
 * POST /api/v1/set-project
 * Set active project ID
 * 
 * Request:
 * {
 *   projectId: string (required)
 * }
 */
async function apiSetProject(params) {
  try {
    const { projectId } = params;
    
    if (!projectId) {
      return { error: 'Missing projectId' };
    }
    
    await updateProjectId(projectId);
    
    return {
      success: true,
      data: { projectId }
    };
    
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * POST /api/v1/clear-session
 * Clear all session data
 */
async function apiClearSession() {
  try {
    await clearSession();
    return { success: true, message: 'Session cleared' };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * GET /api/v1/queue
 * Get current request queue
 */
function apiGetQueue() {
  return {
    success: true,
    data: {
      queue: requestQueue,
      isProcessing: isProcessingQueue,
      queueLength: requestQueue.length
    }
  };
}

/**
 * POST /api/v1/queue-clear
 * Clear request queue
 */
function apiClearQueue() {
  requestQueue.length = 0;
  return { success: true, message: 'Queue cleared' };
}

// ==================== UTILITIES ====================

/**
 * Delay utility
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for use in background
export {
  initAPIServer,
  processAPIRequest,
  apiGenerateImage,
  apiGetStatus,
  apiGetModels,
  apiDownloadImage
};
