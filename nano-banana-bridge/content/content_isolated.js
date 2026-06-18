/**
 * Content Script - ISOLATED World
 * Bridges page (MAIN world) messages to the background service worker.
 * Guarded so duplicate injection does not register listeners twice.
 */

if (!window.__NANO_BANANA_ISOLATED__) {
  window.__NANO_BANANA_ISOLATED__ = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'NANO_BANANA_STATE') {
      try {
        chrome.runtime.sendMessage({
          action: 'UPDATE_PROJECT',
          projectId: event.data.projectId
        });
      } catch (e) {}
    }
  });
}
