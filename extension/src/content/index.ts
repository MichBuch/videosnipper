// Overlay UI and video selection/capture logic
// mark injected so popup guard can detect
(window as any).__VIDCUT_INJECTED__ = true;

class VidCutOverlay {
  private overlayRoot: HTMLDivElement | null = null;
  private infoLabel: HTMLDivElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private endButton: HTMLButtonElement | null = null;
  private downloadButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;

  private selectedVideo: HTMLVideoElement | null = null;
  private startTime: number | null = null;
  private endTime: number | null = null;

  private mediaRecorder: MediaRecorder | null = null;
  private recordedBlobs: Blob[] = [];

  private keyHandler = (e: KeyboardEvent) => {
    if (!this.overlayRoot) return;
    if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.handleSetStart(); }
    if (e.altKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); this.handleSetEnd(); }
    if (e.altKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); this.handleDownload(); }
    if (e.key === 'Escape') { e.preventDefault(); this.cleanup(); }
  };

  constructor() {}

  public show(video: HTMLVideoElement) {
    this.selectedVideo = video;
    if (this.overlayRoot) {
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }

    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = 'vidcut-overlay';
    this.overlayRoot.innerHTML = `
      <div class="vc-panel">
        <div class="vc-row">
          <div id="vc-info" class="vc-info">Ready. Play the video, set Start (Alt+S), End (Alt+E), then Create (Alt+D).</div>
        </div>
        <div class="vc-row">
          <button id="vc-start">Set Start (Alt+S)</button>
          <button id="vc-end" disabled>Set End (Alt+E)</button>
          <button id="vc-download" disabled>Create Snippet (Alt+D)</button>
          <button id="vc-cancel" class="vc-secondary">Cancel (Esc)</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlayRoot);

    this.infoLabel = this.overlayRoot.querySelector('#vc-info') as HTMLDivElement;
    this.startButton = this.overlayRoot.querySelector('#vc-start') as HTMLButtonElement;
    this.endButton = this.overlayRoot.querySelector('#vc-end') as HTMLButtonElement;
    this.downloadButton = this.overlayRoot.querySelector('#vc-download') as HTMLButtonElement;
    this.cancelButton = this.overlayRoot.querySelector('#vc-cancel') as HTMLButtonElement;

    this.startButton.addEventListener('click', this.handleSetStart);
    this.endButton.addEventListener('click', this.handleSetEnd);
    this.downloadButton.addEventListener('click', this.handleDownload);
    this.cancelButton.addEventListener('click', this.cleanup);

    window.addEventListener('keydown', this.keyHandler, true);
  }

  public async quickCreate(video: HTMLVideoElement, startTime: number, endTime: number) {
    this.selectedVideo = video;
    this.startTime = startTime;
    this.endTime = endTime;
    const durationMs = Math.max(0, (endTime - startTime)) * 1000;
    const stream = this.captureVideoElement(video);
    if (stream) {
      await this.recordStreamForDuration(stream, durationMs, video, startTime);
    } else {
      chrome.runtime.sendMessage({ type: 'VIDCUT_TAB_CAPTURE', data: { durationMs } });
    }
  }

  private handleSetStart = () => {
    if (!this.selectedVideo || !this.infoLabel || !this.endButton) return;
    this.startTime = this.selectedVideo.currentTime;
    this.infoLabel.textContent = `Start set at ${this.startTime.toFixed(2)}s`;
    this.endButton.disabled = false;
  };

  private handleSetEnd = () => {
    if (!this.selectedVideo || !this.infoLabel || !this.downloadButton) return;
    this.endTime = this.selectedVideo.currentTime;
    if (this.startTime === null) return;
    if (this.endTime <= this.startTime) {
      this.infoLabel.textContent = 'End must be after Start';
      return;
    }
    const duration = (this.endTime - this.startTime).toFixed(2);
    this.infoLabel.textContent = `End set at ${this.endTime.toFixed(2)}s (duration ${duration}s)`;
    this.downloadButton.disabled = false;
  };

  private handleDownload = async () => {
    if (!this.selectedVideo || this.startTime === null || this.endTime === null) return;
    const durationMs = (this.endTime - this.startTime) * 1000;

    try {
      const stream = this.captureVideoElement(this.selectedVideo);
      if (stream) {
        await this.recordStreamForDuration(stream, durationMs, this.selectedVideo, this.startTime);
      } else {
        chrome.runtime.sendMessage({
          type: 'VIDCUT_TAB_CAPTURE',
          data: { durationMs }
        });
      }
    } catch (err) {
      console.error('VidCut capture failed', err);
    }
  };

  private captureVideoElement(video: HTMLVideoElement): MediaStream | null {
    try {
      const stream = (video as any).captureStream?.() as MediaStream | undefined;
      if (!stream) return null;
      return stream;
    } catch {
      return null;
    }
  }

  private async recordStreamForDuration(stream: MediaStream, durationMs: number, video: HTMLVideoElement, startTime: number) {
    this.recordedBlobs = [];

    const preferredMimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    let mimeType: string | undefined = undefined;
    for (const m of preferredMimeTypes) {
      if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
    }

    this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.recordedBlobs.push(event.data);
    };

    const videoWasPaused = video.paused;
    const originalTime = video.currentTime;

    try {
      video.currentTime = startTime;
      await video.play();
    } catch {}

    this.mediaRecorder.start();

    await new Promise((res) => setTimeout(res, durationMs));

    this.mediaRecorder.stop();

    await new Promise<void>((resolve) => {
      if (!this.mediaRecorder) return resolve();
      this.mediaRecorder.onstop = () => resolve();
    });

    try {
      video.pause();
      video.currentTime = originalTime;
      if (!videoWasPaused) video.play();
    } catch {}

    const blob = new Blob(this.recordedBlobs, { type: this.recordedBlobs[0]?.type || 'video/webm' });

    if (!blob || blob.size === 0) {
      chrome.runtime.sendMessage({ type: 'VIDCUT_TAB_CAPTURE', data: { durationMs } });
      this.cleanup();
      return;
    }

    const fileName = `VidCut_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    chrome.runtime.sendMessage({ type: 'VIDCUT_DOWNLOAD', data: { base64, mime: blob.type, fileName } });

    this.cleanup();
  }

  private cleanup = () => {
    this.selectedVideo = null;
    this.startTime = null;
    this.endTime = null;
    this.recordedBlobs = [];
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch {}
    }
    if (this.overlayRoot) {
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }
    window.removeEventListener('keydown', this.keyHandler, true);
  };
}

class VideoDetector {
  private videos: HTMLVideoElement[] = [];
  private overlay = new VidCutOverlay();

  constructor() {
    this.scan();
    const obs = new MutationObserver(() => this.scan());
    obs.observe(document.documentElement, { childList: true, subtree: true });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'START_RECORDING') {
        const video = this.videos[0];
        if (video) this.overlay.show(video);
      }
      if (msg?.type === 'GET_VIDEO_STATUS') {
        sendResponse({ hasVideos: this.videos.length > 0 });
      }
      if (msg?.type === 'GET_CURRENT_TIME') {
        const video = this.videos[0];
        sendResponse({ currentTime: video ? video.currentTime : null });
      }
      if (msg?.type === 'VIDCUT_CREATE_SNIPPET') {
        const video = this.videos[0];
        if (video && msg.data) {
          const { startTime, endTime } = msg.data as { startTime: number; endTime: number };
          this.overlay.quickCreate(video, startTime, endTime);
        }
      }
      return true;
    });
  }

  private scan() {
    const found = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    this.videos = found.filter(v => v.videoWidth > 0 && v.videoHeight > 0);
  }
}

const globalAny = window as any;
if (!globalAny.__VIDCUT_VIDEO_DETECTOR__) {
  globalAny.__VIDCUT_VIDEO_DETECTOR__ = new VideoDetector();
}