// Offscreen page: receives a request to record the current tab via chrome.tabCapture,
// runs MediaRecorder in a DOM context, and returns the base64 video to the background.

async function record(durationMs: number) {
  const stream: MediaStream | null = await new Promise((resolve) => {
    try {
      chrome.tabCapture.capture(
        {
          audio: true,
          video: true,
          videoConstraints: { maxFrameRate: 30 } as any,
          audioConstraints: true as any
        },
        (s) => resolve(s)
      );
    } catch (e) {
      console.error('tabCapture error', e);
      resolve(null);
    }
  });

  if (!stream) throw new Error('Failed to capture tab in offscreen');

  const preferredMimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  let mimeType: string | undefined;
  for (const m of preferredMimeTypes) {
    try { if ((MediaRecorder as any).isTypeSupported?.(m) || MediaRecorder.isTypeSupported(m)) { mimeType = m; break; } } catch {}
  }

  const chunks: Blob[] = [];
  const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mr.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
  mr.start();
  await new Promise((res) => setTimeout(res, durationMs));
  mr.stop();
  await new Promise<void>((res) => { mr.onstop = () => res(); });

  try { stream.getTracks().forEach(t => t.stop()); } catch {}

  const blob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
  if (!blob || blob.size === 0) throw new Error('Offscreen recorded blob empty');

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const fileName = `VidCut_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_RECORD_COMPLETE', data: { base64, mime: blob.type, fileName } });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'OFFSCREEN_RECORD') {
        await record(Math.max(0, msg.data?.durationMs ?? 0));
        sendResponse({ success: true });
        return;
      }
    } catch (e) {
      console.error('Offscreen error', e);
      sendResponse({ success: false, error: String(e) });
    }
  })();
  return true;
});


