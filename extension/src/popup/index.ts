document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('video-status') as HTMLDivElement;
  const btnOpen = document.getElementById('open-controls') as HTMLButtonElement;

  function injectIfNeeded(callback: () => void) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return callback();
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            // Ensure we only inject once per page load
            if ((window as any).__VIDCUT_INJECTED__) return false;
            (window as any).__VIDCUT_INJECTED__ = true;
            return true;
          }
        },
        (results) => {
          const shouldInject = results && results[0] && results[0].result === true;
          if (!shouldInject) return callback();
          chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
            chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }, () => callback());
          });
        }
      );
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

  injectIfNeeded(checkOnce);

  btnOpen.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id; if (id == null) return;
      chrome.tabs.sendMessage(id, { type: 'START_RECORDING' });
      window.close();
    });
  });
});