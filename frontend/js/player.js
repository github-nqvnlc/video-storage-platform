// frontend/js/player.js - HLS Stream Player Engine

class HlsVideoPlayer {
  constructor(videoElementId) {
    this.videoElementId = videoElementId;
    this.video = document.getElementById(videoElementId);
    this.hls = null;
    this.currentVideoId = null;
    this.availableLevels = [];
  }

  getVideoElement() {
    if (!this.video) {
      this.video = document.getElementById(this.videoElementId);
    }
    return this.video;
  }

  loadStream(streamUrl, videoId) {
    this.currentVideoId = videoId;
    this.destroy();

    if (!streamUrl) {
      console.error('No stream URL provided');
      return;
    }

    // Đảm bảo URL stream dùng đúng Origin hiện tại của trình duyệt
    let targetUrl = streamUrl;
    try {
      const parsed = new URL(streamUrl);
      const currentOrigin = new URL(window.location.origin);
      if (parsed.hostname !== currentOrigin.hostname) {
        parsed.protocol = currentOrigin.protocol;
        parsed.host = currentOrigin.host;
        parsed.port = currentOrigin.port;
        targetUrl = parsed.toString();
      }
    } catch (e) {
      console.warn('Player URL fallback:', e);
    }

    const video = this.getVideoElement();
    if (!video) {
      console.error('Video element not found:', this.videoElementId);
      return;
    }

    if (window.Hls && Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      this.hls.loadSource(targetUrl);
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.availableLevels = data.levels || [];
        this.renderQualitySelector();
        video.play().catch((e) => console.warn('Autoplay prevented:', e));
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('Fatal network error, trying to recover...', data);
              this.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('Fatal media error, trying to recover...', data);
              this.hls.recoverMediaError();
              break;
            default:
              console.error('Fatal unrecoverable HLS error:', data);
              this.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS for Safari
      video.src = targetUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    } else {
      alert('Trình duyệt của bạn không hỗ trợ phát video HLS.');
    }
  }

  renderQualitySelector() {
    const selector = document.getElementById('qualitySelector');
    if (!selector) return;

    selector.innerHTML = '<option value="-1">Chất lượng: Auto</option>';
    this.availableLevels.forEach((level, index) => {
      const label = `${level.height}p (${Math.round(level.bitrate / 1000)} kbps)`;
      const opt = document.createElement('option');
      opt.value = index;
      opt.textContent = label;
      selector.appendChild(opt);
    });

    selector.onchange = (e) => {
      const levelIdx = parseInt(e.target.value, 10);
      if (this.hls) {
        this.hls.currentLevel = levelIdx;
      }
    };
  }

  destroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    const video = this.getVideoElement();
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.availableLevels = [];
  }
}

// Khởi tạo instance toàn cục cho player
const videoPlayerInstance = new HlsVideoPlayer('hlsPlayer');
