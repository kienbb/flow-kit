/**
 * Content Script - MAIN World
 * Reports the current Flow projectId to the extension and primes the
 * background webRequest listener so the Bearer token gets captured.
 * No UI automation: generation is driven entirely via the API.
 */

if (window.__NANO_BANANA_LOADED__) {
  console.log('[NanoBanana] content_main.js already loaded, skipping');
} else {
  window.__NANO_BANANA_LOADED__ = true;
  console.log('[NanoBanana] content_main.js loaded');

  function getProjectIdFromUrl() {
    const match = window.location.href.match(/\/project\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function reportState() {
    window.postMessage({
      type: 'NANO_BANANA_STATE',
      projectId: getProjectIdFromUrl()
    }, '*');
  }

  setTimeout(reportState, 500);
  window.addEventListener('popstate', reportState);

  // Fire a throwaway authenticated request so the background Authorization
  // listener captures the Bearer token before the first generate call.
  function primeTokenCapture() {
    try {
      fetch('https://labs.google/fx/api/trpc/user.get?batch=1').catch(() => {});
    } catch (e) {}
  }

  setTimeout(primeTokenCapture, 2000);
  setTimeout(primeTokenCapture, 5000);
  setTimeout(primeTokenCapture, 10000);
}
