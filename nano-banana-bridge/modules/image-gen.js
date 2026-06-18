/**
 * Image Generation Module
 * Controls Google Flow image generation purely via API (no UI automation).
 *
 * Why this is not a plain service-worker fetch:
 *   Google Flow's batchGenerateImages endpoint requires a fresh reCAPTCHA
 *   Enterprise token that can ONLY be minted inside the labs.google page
 *   context (window.grecaptcha.enterprise). It also relies on the page's
 *   first-party cookies. So the request is executed INSIDE the Flow tab's
 *   MAIN world via chrome.scripting.executeScript. The tab only needs to be
 *   open and logged in - we never type prompts or click buttons.
 *
 * batchGenerateImages is SYNCHRONOUS: the response already contains the media.
 * (Only video uses the async batchAsyncGenerate* + polling flow.)
 */

import { sessionData, loadFlowConfig, findFlowTab, ensureFlowTab } from './session.js';

const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
const RECAPTCHA_SETTLE_MS = 600;

/**
 * Map a friendly model name to the Flow image model id (e.g. GEM_PIX_2).
 * Longest-key-first substring match against config.imageModels.
 */
function mapImageModelKey(name, config) {
  const lower = (name || '').toLowerCase();
  const models = config?.imageModels || {};
  const keys = Object.keys(models).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return models[key];
  }
  return config?.defaultSettings?.model || 'GEM_PIX_2';
}

/**
 * Map an aspect ratio (e.g. "16:9", "landscape") to the Flow constant.
 */
function mapImageAspectRatio(ratio, config) {
  const norm = (ratio || '').toLowerCase().replace(/\s/g, '');
  const ratios = config?.imageAspectRatios || {};
  if (ratios[norm]) return ratios[norm];
  for (const [key, value] of Object.entries(ratios)) {
    if (norm === key) return value;
  }
  return config?.defaultSettings?.aspectRatio || 'IMAGE_ASPECT_RATIO_SQUARE';
}

/**
 * Mint a fresh reCAPTCHA Enterprise token inside the Flow tab.
 * Returns the token string or null (generation still works in many cases
 * without it, but it greatly reduces 401/403 throttling).
 */
async function getFreshRecaptchaToken(tabId, action = 'image_generation') {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (siteKey, act) => {
        if (window.grecaptcha?.enterprise) {
          try {
            return await window.grecaptcha.enterprise.execute(siteKey, { action: act });
          } catch (e) {
            return null;
          }
        }
        return null;
      },
      args: [RECAPTCHA_SITE_KEY, action]
    });
    return results?.[0]?.result || null;
  } catch (e) {
    console.warn('[NanoBanana] reCAPTCHA error:', e.message);
    return null;
  }
}

/**
 * Execute a fetch INSIDE the Flow tab's MAIN world so it carries the page's
 * first-party cookies (credentials: 'include') and same origin.
 * Returns { ok, status, text }.
 */
async function fetchInFlowTab(tabId, url, method, bearerToken, bodyObj) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (reqUrl, reqMethod, authToken, payload) => {
      try {
        const headers = { 'authorization': authToken };
        const init = { method: reqMethod, credentials: 'include', headers };
        if (payload !== null && payload !== undefined) {
          headers['content-type'] = 'application/json';
          init.body = JSON.stringify(payload);
        } else {
          headers['accept'] = 'image/*';
        }
        const res = await fetch(reqUrl, init);
        const text = await res.text();
        return { ok: res.ok, status: res.status, text };
      } catch (e) {
        return { ok: false, status: 0, text: e.message };
      }
    },
    args: [url, method, bearerToken, bodyObj ?? null]
  });
  return results?.[0]?.result || { ok: false, status: 0, text: 'no-result' };
}

/**
 * Generate images with Google Flow.
 * @param {Object} params
 * @param {string} params.prompt        - required
 * @param {string} [params.aspectRatio] - '1:1' | '16:9' | '9:16'
 * @param {number} [params.count]       - 1-4 (image variations live in the batch response)
 * @param {string} [params.model]       - friendly model name, default Nano Banana Pro
 * @param {number} [params.seed]
 * @returns {Promise<{success, mediaIds, workflowIds, images, rawResponse, timestamp}>}
 */
async function generateImage(params) {
  const {
    prompt,
    aspectRatio = '1:1',
    count = 4,
    model = 'nano banana pro',
    seed = null
  } = params;

  if (!prompt) throw new Error('Missing required field: prompt');
  if (!sessionData?.bearerToken) {
    throw new Error('No bearer token. Open Google Flow (labs.google/fx/tools/flow) and login first.');
  }
  if (!sessionData?.projectId) {
    throw new Error('No project ID. Open a Flow project, or call set-project with a projectId.');
  }

  const config = await loadFlowConfig();
  const modelId = mapImageModelKey(model, config);
  const aspectConstant = mapImageAspectRatio(aspectRatio, config);
  const projectId = sessionData.projectId;

  // Make sure a Flow tab exists (without forcing a reload). The tab is the
  // execution context for reCAPTCHA + the authenticated fetch.
  const tab = await ensureFlowTab();
  if (!tab?.id) throw new Error('Could not obtain a Google Flow tab.');

  console.log('[NanoBanana] Generating image:', {
    prompt: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''),
    model: modelId,
    aspectRatio: aspectConstant,
    count: Math.min(Math.max(parseInt(count) || 4, 1), 4)
  });

  const recaptchaToken = await getFreshRecaptchaToken(tab.id, 'image_generation');
  if (recaptchaToken) {
    await new Promise(r => setTimeout(r, RECAPTCHA_SETTLE_MS));
  }

  const recaptchaContext = recaptchaToken
    ? { token: recaptchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' }
    : undefined;

  const clientContext = {
    recaptchaContext,
    projectId,
    tool: 'PINHOLE',
    sessionId: ';' + Date.now()
  };

  const request = {
    clientContext,
    imageModelName: modelId,
    imageAspectRatio: aspectConstant,
    structuredPrompt: { parts: [{ text: prompt }] },
    seed: seed != null ? parseInt(seed) : Math.floor(Math.random() * 1000000),
    imageInputs: []
  };

  const body = {
    clientContext,
    mediaGenerationContext: {
      batchId: (crypto.randomUUID && crypto.randomUUID()) ||
               (Math.random().toString(36).slice(2) + Date.now())
    },
    useNewMedia: true,
    requests: [request]
  };

  const url = `${config.googleApi.base}/${config.googleApi.generateImage.replace('{projectId}', projectId)}`;
  const res = await fetchInFlowTab(tab.id, url, 'POST', sessionData.bearerToken, body);

  if (!res.ok) {
    throw new Error(`API Error ${res.status}: ${(res.text || '').substring(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(res.text);
  } catch (e) {
    throw new Error('Failed to parse generation response: ' + e.message);
  }

  const parsed = extractMedia(data);
  console.log('[NanoBanana] Generation successful:', {
    mediaCount: parsed.mediaIds.length,
    withInlineImages: parsed.images.filter(i => i.base64).length
  });

  return {
    success: true,
    mediaIds: parsed.mediaIds,
    workflowIds: parsed.workflowIds,
    images: parsed.images,
    rawResponse: data,
    timestamp: Date.now()
  };
}

/**
 * Extract media ids / workflow ids / inline images from a batchGenerateImages
 * response. Response shape: { media: [ { name, workflowId, image: {...} } ], workflows: [...] }
 */
function extractMedia(response) {
  const mediaIds = [];
  const workflowIds = [];
  const images = [];

  const mediaList = Array.isArray(response?.media)
    ? response.media
    : (Array.isArray(response?.responses) ? response.responses : []);

  for (const item of mediaList) {
    const media = item?.media ? item.media : item; // tolerate {media:{...}} wrapper
    const id = media?.name || media?.mediaId || null;
    const wfId = media?.workflowId || null;
    if (id) mediaIds.push(id);
    if (wfId) workflowIds.push(wfId);

    const img = media?.image || {};
    const inlineBase64 = img.imageBytes || img.encodedImage || img.bytesBase64Encoded || null;
    const url = img.generatedImage?.fifeUrl || img.generatedImage?.url || img.uri || img.url || null;

    if (id || inlineBase64 || url) {
      images.push({
        mediaId: id,
        workflowId: wfId,
        base64: inlineBase64,
        url,
        mimeType: img.mimeType || 'image/png'
      });
    }
  }

  // Top-level fallbacks
  if (response?.workflows?.[0]?.name && workflowIds.length === 0) {
    workflowIds.push(response.workflows[0].name);
  }

  return {
    mediaIds: [...new Set(mediaIds)],
    workflowIds: [...new Set(workflowIds)],
    images
  };
}

/**
 * Download an image's bytes as base64.
 * Runs inside the Flow tab so first-party auth/cookies apply.
 * @param {string} mediaId
 * @returns {Promise<{mediaId, base64, mimeType, url}>}
 */
async function downloadImage(mediaId) {
  if (!mediaId) throw new Error('Missing mediaId');
  if (!sessionData?.bearerToken) {
    throw new Error('No bearer token. Open Google Flow and login first.');
  }

  const config = await loadFlowConfig();
  const tab = await findFlowTab();
  if (!tab?.id) throw new Error('No Google Flow tab available for authenticated download.');

  // mediaId may be a full resource name ("media/abc" or "projects/.../media/abc")
  // or a bare id. getMedia template is "media/{mediaId}".
  const idForUrl = mediaId.includes('/') ? mediaId : config.googleApi.getMedia.replace('{mediaId}', mediaId);
  const base = config.googleApi.base;
  const url = idForUrl.startsWith('http')
    ? idForUrl
    : `${base}/${idForUrl.replace(/^\/+/, '')}`;

  const res = await fetchInFlowTab(tab.id, url, 'GET', sessionData.bearerToken, null);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  // The media endpoint may return JSON (with a fifeUrl/uri) or raw text. Try JSON first.
  let directUrl = null;
  let mimeType = 'image/jpeg';
  try {
    const json = JSON.parse(res.text);
    const img = json?.media?.image || json?.image || json;
    const inline = img?.imageBytes || img?.encodedImage || img?.bytesBase64Encoded;
    if (inline) {
      return { mediaId, base64: inline, mimeType: img?.mimeType || 'image/png', url };
    }
    directUrl = img?.generatedImage?.fifeUrl || img?.generatedImage?.url || img?.uri || img?.url || null;
    if (img?.mimeType) mimeType = img.mimeType;
  } catch (e) {
    // Not JSON - treat as a direct URL string if it looks like one
    if (/^https?:\/\//.test(res.text.trim())) directUrl = res.text.trim();
  }

  if (directUrl) {
    const dl = await fetchBinaryInFlowTab(tab.id, directUrl);
    if (dl?.base64) {
      return { mediaId, base64: dl.base64, mimeType: dl.mimeType || mimeType, url: directUrl };
    }
  }

  throw new Error('Could not resolve image bytes for mediaId: ' + mediaId);
}

/**
 * Fetch a (possibly cross-origin, public) image URL inside the Flow tab and
 * return it as base64. fifeUrl/lh3 URLs are public and need no auth.
 */
async function fetchBinaryInFlowTab(tabId, url) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (imgUrl) => {
      try {
        const res = await fetch(imgUrl, { redirect: 'follow' });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x2000;
        for (let i = 0; i < u8.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
        }
        return {
          base64: btoa(bin),
          mimeType: res.headers.get('content-type') || 'image/jpeg'
        };
      } catch (e) {
        return null;
      }
    },
    args: [url]
  });
  return results?.[0]?.result || null;
}

/**
 * Batch generate multiple prompts sequentially (Flow throttles parallel calls).
 */
async function batchGenerate(prompts, options = {}) {
  const results = [];
  for (let i = 0; i < prompts.length; i++) {
    try {
      results.push(await generateImage({ prompt: prompts[i], ...options }));
    } catch (error) {
      results.push({ success: false, error: error.message, prompt: prompts[i] });
    }
    if (i < prompts.length - 1) await delay(1500);
  }
  return results;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAvailableModels() {
  return {
    'nano banana pro': { id: 'GEM_PIX_2', name: 'Nano Banana Pro', description: 'Highest quality', maxCount: 4 },
    'nano banana 2':   { id: 'NARWHAL',   name: 'Nano Banana 2',   description: 'Balanced',        maxCount: 4 },
    'nano banana':     { id: 'GEM_PIX_0', name: 'Nano Banana',     description: 'Fast',            maxCount: 4 }
  };
}

function getAvailableAspectRatios() {
  return {
    '1:1':  { name: 'Square',    constant: 'IMAGE_ASPECT_RATIO_SQUARE' },
    '16:9': { name: 'Landscape', constant: 'IMAGE_ASPECT_RATIO_LANDSCAPE' },
    '9:16': { name: 'Portrait',  constant: 'IMAGE_ASPECT_RATIO_PORTRAIT' }
  };
}

export {
  generateImage,
  downloadImage,
  batchGenerate,
  extractMedia,
  mapImageModelKey,
  mapImageAspectRatio,
  getAvailableModels,
  getAvailableAspectRatios
};
