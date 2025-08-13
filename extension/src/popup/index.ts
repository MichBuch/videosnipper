document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('video-status') as HTMLDivElement;
  const btnOpen = document.getElementById('open-controls') as HTMLButtonElement;

  function ensureContentAvailable(callback: () => void) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return callback();

      // First try to reach existing content script
      chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_STATUS' }, (resp) => {
        if (!chrome.runtime.lastError && resp) {
          return callback();
        }
        // Not present: inject once
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
          chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }, () => callback());
        });
      });
    });
  }

  function checkOnce() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id;
      if (id == null) return;
      chrome.tabs.sendMessage(id, { type: 'GET_VIDEO_STATUS' }, (resp) => {
        const hasVideo = !!resp?.hasVideos;
        statusEl.textContent = hasVideo ? 'Video detected' : 'No video detected';
        statusEl.className = `status ${hasVideo ? 'active' : 'inactive'}`;
        btnOpen.disabled = !hasVideo;
      });
    });
  }

  ensureContentAvailable(checkOnce);

  btnOpen.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id; if (id == null) return;
      chrome.tabs.sendMessage(id, { type: 'START_RECORDING' });
      window.close();
    });
  });
});