// frontend/js/api.js - Windy Storage API Service
const API_BASE = '/api/v1/videos';

const api = {
  /**
   * Lấy danh sách video
   */
  async getVideos(params = {}) {
    const cleanParams = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'undefined') {
        cleanParams[k] = v;
      }
    });
    const query = new URLSearchParams(cleanParams).toString();
    const res = await fetch(`${API_BASE}${query ? `?${query}` : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi tải danh sách video');
    return data.data;
  },

  /**
   * Tìm kiếm video qua Meilisearch
   */
  async searchVideos(params = {}) {
    const cleanParams = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'undefined') {
        cleanParams[k] = v;
      }
    });
    const query = new URLSearchParams(cleanParams).toString();
    const res = await fetch(`${API_BASE}/search${query ? `?${query}` : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi tìm kiếm');
    return data.data;
  },

  /**
   * Lấy chi tiết video & link HLS
   */
  async getVideoById(id) {
    const res = await fetch(`${API_BASE}/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi lấy chi tiết video');
    return data.data;
  },

  /**
   * Upload video trực tiếp qua API Server lên MinIO (Tin cậy 100%, có thanh tiến trình %)
   */
  uploadVideoDirect(formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/upload`, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent, e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data.data);
          } else {
            reject(new Error(data.error?.message || `Lỗi tải lên (${xhr.status})`));
          }
        } catch (e) {
          reject(new Error(`Phản hồi không hợp lệ (${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error('Lỗi kết nối mạng khi tải lên video'));
      xhr.send(formData);
    });
  },

  /**
   * Khởi tạo upload intent & nhận MinIO Presigned URL
   */
  async createUploadIntent(payload) {
    const res = await fetch(`${API_BASE}/upload-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi khởi tạo upload');
    return data.data;
  },

  /**
   * Direct Upload lên MinIO qua Presigned PUT URL với XMLHttpRequest theo dõi %
   */
  uploadToMinio(uploadUrl, file, onProgress) {
    return new Promise((resolve, reject) => {
      let targetUrl = uploadUrl;
      try {
        const parsed = new URL(uploadUrl);
        const currentOrigin = new URL(window.location.origin);
        
        if (parsed.hostname !== currentOrigin.hostname) {
          parsed.protocol = currentOrigin.protocol;
          parsed.host = currentOrigin.host;
          parsed.port = currentOrigin.port;
          targetUrl = parsed.toString();
        }
      } catch (e) {
        console.warn('URL parse fallback:', e);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('PUT', targetUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent, e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`MinIO Upload thất bại với mã lỗi HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('MinIO Network error during upload'));
      xhr.send(file);
    });
  },

  /**
   * Xác nhận hoàn tất upload video
   */
  async completeUpload(videoId, fileSizeBytes) {
    const res = await fetch(`${API_BASE}/${videoId}/complete-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileSizeBytes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi hoàn tất upload');
    return data.data;
  },

  /**
   * Tăng view count
   */
  async incrementView(id) {
    try {
      await fetch(`${API_BASE}/${id}/view`, { method: 'POST' });
    } catch (e) {
      console.warn('Increment view failed:', e);
    }
  },

  /**
   * Cập nhật video metadata
   */
  async updateVideo(id, payload) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi cập nhật video');
    return data.data;
  },

  /**
   * Thử lại transcode video bị lỗi
   */
  async retryVideo(id) {
    const res = await fetch(`${API_BASE}/${id}/retry`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi gửi yêu cầu thử lại');
    return data.data;
  },

  /**
   * Xóa video
   */
  async deleteVideo(id) {
    const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Lỗi xóa video');
    return data.data;
  },
};
