// Overlay UI and video selection/capture logic
// mark injected so popup guard can detect
(window as any).__VIDCUT_INJECTED__ = true;

class VidCutOverlay {
  private overlayRoot: HTMLDivElement | null = null;
  private infoLabel: HTMLDivElement | null = null;
  private currentTimeLabel: HTMLSpanElement | null = null;
  private startTimeLabel: HTMLSpanElement | null = null;
  private endTimeLabel: HTMLSpanElement | null = null;
  private slider: HTMLInputElement | null = null;
  private progressRow: HTMLDivElement | null = null;
  private progressBar: HTMLDivElement | null = null;
  private progressTimer: number | null = null;
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
          <div id="vc-info" class="vc-info">Ready. Set Start (Alt+S), End (Alt+E), then Create (Alt+D).</div>
        </div>
        <div class="vc-row vc-times">
          <span id="vc-current" class="vc-badge">00:00</span>
          <span class="vc-spacer"></span>
          <span>Start: <strong id="vc-start-time">--:--</strong></span>
          <span>End: <strong id="vc-end-time">--:--</strong></span>
        </div>
        <div class="vc-row">
          <input id="vc-slider" type="range" min="0" max="0" value="0" step="0.01" class="vc-slider" />
        </div>
        <div class="vc-row">
          <button id="vc-start">Set Start (Alt+S)</button>
          <button id="vc-end" disabled>Set End (Alt+E)</button>
          <button id="vc-download" disabled>Create Snippet (Alt+D)</button>
          <button id="vc-cancel" class="vc-secondary">Cancel (Esc)</button>
        </div>
        <div id="vc-progress-row" class="vc-row vc-progress" style="display:none">
          <div class="vc-progress-track"><div id="vc-progress-bar" class="vc-progress-bar" style="width:0%"></div></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlayRoot);

    this.infoLabel = this.overlayRoot.querySelector('#vc-info') as HTMLDivElement;
    this.currentTimeLabel = this.overlayRoot.querySelector('#vc-current') as HTMLSpanElement;
    this.startTimeLabel = this.overlayRoot.querySelector('#vc-start-time') as HTMLSpanElement;
    this.endTimeLabel = this.overlayRoot.querySelector('#vc-end-time') as HTMLSpanElement;
    this.slider = this.overlayRoot.querySelector('#vc-slider') as HTMLInputElement;
    this.progressRow = this.overlayRoot.querySelector('#vc-progress-row') as HTMLDivElement;
    this.progressBar = this.overlayRoot.querySelector('#vc-progress-bar') as HTMLDivElement;
    this.startButton = this.overlayRoot.querySelector('#vc-start') as HTMLButtonElement;
    this.endButton = this.overlayRoot.querySelector('#vc-end') as HTMLButtonElement;
    this.downloadButton = this.overlayRoot.querySelector('#vc-download') as HTMLButtonElement;
    this.cancelButton = this.overlayRoot.querySelector('#vc-cancel') as HTMLButtonElement;

    this.startButton.addEventListener('click', this.handleSetStart);
    this.endButton.addEventListener('click', this.handleSetEnd);
    this.downloadButton.addEventListener('click', this.handleDownload);
    this.cancelButton.addEventListener('click', this.cleanup);

    window.addEventListener('keydown', this.keyHandler, true);

    // Initialize slider and labels
    const updateDuration = () => {
      if (!this.slider || !this.selectedVideo) return;
      const dur = this.selectedVideo.duration;
      if (isFinite(dur) && !isNaN(dur)) {
        this.slider.max = String(Math.max(0, dur));
        this.slider.disabled = false;
      } else {
        this.slider.max = '0';
        this.slider.disabled = true;
      }
      this.updateCurrentTimeLabel(this.selectedVideo.currentTime);
    };
    const onTimeUpdate = () => {
      if (!this.slider || !this.selectedVideo) return;
      this.slider.value = String(this.selectedVideo.currentTime);
      this.updateCurrentTimeLabel(this.selectedVideo.currentTime);
    };
    this.selectedVideo.addEventListener('loadedmetadata', updateDuration, { once: true });
    this.selectedVideo.addEventListener('durationchange', updateDuration);
    this.selectedVideo.addEventListener('timeupdate', onTimeUpdate);
    if (this.slider) {
      this.slider.addEventListener('input', () => {
        if (!this.selectedVideo || !this.slider) return;
        const val = parseFloat(this.slider.value);
        if (isFinite(val)) {
          try { this.selectedVideo.currentTime = val; } catch {}
          this.updateCurrentTimeLabel(val);
        }
      });
    }
    updateDuration();
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
    this.infoLabel.textContent = `Start set at ${this.formatTime(this.startTime)}`;
    if (this.startTimeLabel) this.startTimeLabel.textContent = this.formatTime(this.startTime);
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
    const duration = this.endTime - this.startTime;
    this.infoLabel.textContent = `End set at ${this.formatTime(this.endTime)} (duration ${this.formatTime(duration)})`;
    if (this.endTimeLabel) this.endTimeLabel.textContent = this.formatTime(this.endTime);
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
        chrome.runtime.sendMessage({ type: 'VIDCUT_TAB_CAPTURE', data: { durationMs } });
      }
    } catch (err) {
      console.error('VidCut capture failed', err);
    }
  };

  private captureVideoElement(video: HTMLVideoElement): MediaStream | null {
    try {
      const host = location.hostname;
      if (host.includes('youtube.com') || host.includes('youtu.be')) {
        return null;
      }
      const stream = (video as any).captureStream?.() as MediaStream | undefined;
      if (!stream) return null;
      const hasTracks = stream.getTracks && stream.getTracks().length > 0;
      if (!hasTracks) return null;
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

    try {
      this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      chrome.runtime.sendMessage({ type: 'VIDCUT_TAB_CAPTURE', data: { durationMs } });
      this.cleanup();
      return;
    }
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.recordedBlobs.push(event.data);
    };

    const videoWasPaused = video.paused;
    const originalTime = video.currentTime;

    try {
      video.currentTime = startTime;
      await video.play();
    } catch {}

    // UI: show progress and disable controls
    this.setRecordingUI(true, durationMs);
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
      // Fallback once to tab capture; do not recurse further inside this method
      chrome.runtime.sendMessage({ type: 'VIDCUT_TAB_CAPTURE', data: { durationMs } });
      this.cleanup();
      return;
    }

    const fileName = `VidCut_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    chrome.runtime.sendMessage({ type: 'VIDCUT_DOWNLOAD', data: { base64, mime: blob.type, fileName } });

    this.setRecordingUI(false);
    this.cleanup();
  }

  private setRecordingUI(isRecording: boolean, durationMs?: number) {
    if (this.startButton) this.startButton.disabled = isRecording;
    if (this.endButton) this.endButton.disabled = isRecording || this.startTime === null;
    if (this.downloadButton) this.downloadButton.disabled = isRecording;
    if (this.slider) this.slider.disabled = isRecording;
    if (this.progressRow) this.progressRow.style.display = isRecording ? 'flex' : 'none';
    if (!isRecording) {
      if (this.progressTimer) { window.clearInterval(this.progressTimer); this.progressTimer = null; }
      if (this.progressBar) this.progressBar.style.width = '0%';
      if (this.infoLabel) this.infoLabel.textContent = 'Ready.';
      return;
    }
    if (!this.progressBar || !durationMs) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, Math.min(100, (elapsed / durationMs) * 100));
      this.progressBar!.style.width = `${pct}%`;
      if (this.infoLabel) this.infoLabel.textContent = `Recording… ${Math.ceil((durationMs - elapsed) / 1000)}s`;
      if (elapsed >= durationMs && this.progressTimer) {
        window.clearInterval(this.progressTimer);
        this.progressTimer = null;
      }
    };
    tick();
    this.progressTimer = window.setInterval(tick, 100);
  }

  private updateCurrentTimeLabel(seconds: number) {
    if (!this.currentTimeLabel) return;
    this.currentTimeLabel.textContent = this.formatTime(seconds);
  }

  private formatTime(sec: number): string {
    if (!isFinite(sec) || isNaN(sec)) return '--:--';
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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
      // Avoid returning true by default to prevent hanging callbacks; only if we actually async respond
      if (msg?.type === 'GET_VIDEO_STATUS' || msg?.type === 'GET_CURRENT_TIME') {
        return true;
      }
      return false;
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