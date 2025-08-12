// Background: capture + download (auth later)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'CHECK_AUTH') {
        sendResponse({ isAuthenticated: true });
        return;
      }
      if (message?.type === 'VIDCUT_DOWNLOAD') {
        await handleDownload(message.data);
        sendResponse({ success: true });
        return;
      }
      if (message?.type === 'VIDCUT_TAB_CAPTURE') {
        await handleTabCapture(message.data?.durationMs ?? 0);
        sendResponse({ success: true });
        return;
      }
      if (message?.type === 'OFFSCREEN_RECORD_COMPLETE') {
        const { base64, mime, fileName } = message.data || {};
        if (base64 && mime && fileName) {
          await handleDownload({ base64, mime, fileName });
          // attempt to close offscreen doc to avoid reuse issues
          try { await closeOffscreenDocument(); } catch {}
          sendResponse({ success: true });
          return;
        }
      }
    } catch (e) {
      console.error('Background error', e);
      sendResponse({ success: false, error: String(e) });
    }
  })();
  return true;
});

async function handleDownload(args: { base64: string; mime: string; fileName: string }) {
  const { base64, mime, fileName } = args;
  const url = `data:${mime};base64,${base64}`;

  const downloadId = await new Promise<number>((resolve, reject) => {
    chrome.downloads.download(
      { url, filename: fileName, saveAs: true, conflictAction: 'uniquify' },
      (id) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (id === undefined || id === null) return reject(new Error('No download id'));
        resolve(id);
      }
    );
  });

  const finalItem = await new Promise<chrome.downloads.DownloadItem>((resolve) => {
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id === downloadId && delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(onChanged);
        chrome.downloads.search({ id: downloadId }, (items) => resolve(items[0]));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
  });

  if (finalItem?.filename) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'VidCut',
      message: `Snippet saved: ${finalItem.filename}`
    });
    try { chrome.downloads.show(downloadId); } catch {}
  }
}

async function handleTabCapture(_durationMs: number) {
  const durationMs = Math.max(0, _durationMs);
  const activeTab = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });

  if (!activeTab) throw new Error('No active tab to capture');

  await ensureOffscreenDocument();
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_RECORD',
      data: { durationMs }
    }, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!resp?.success) return reject(new Error(resp?.error || 'Offscreen record failed'));
      resolve();
    });
  });
}

async function recordAndDownloadFromStream(stream: MediaStream, durationMs: number) {
  const preferredMimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  let mimeType: string | undefined = undefined;
  for (const m of preferredMimeTypes) {
    try { if ((MediaRecorder as any).isTypeSupported?.(m) || MediaRecorder.isTypeSupported(m)) { mimeType = m; break; } } catch {}
  }

  const recorded: Blob[] = [];
  const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mediaRecorder.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) recorded.push(ev.data); };

  mediaRecorder.start();
  await new Promise((res) => setTimeout(res, durationMs));
  mediaRecorder.stop();
  await new Promise<void>((res) => { mediaRecorder.onstop = () => res(); });

  const blob = new Blob(recorded, { type: recorded[0]?.type || 'video/webm' });

  if (!blob || blob.size === 0) throw new Error('Captured video was empty');

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const fileName = `VidCut_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;

  await handleDownload({ base64, mime: blob.type, fileName });
}

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record tab audio/video reliably via MediaRecorder in a DOM'
  } as any);
}

async function closeOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (!has) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch {}
}