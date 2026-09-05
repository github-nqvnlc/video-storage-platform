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
  uploadVideoDirect(fileOrFormData, metaOrProgress, onProgress) {
    return new Promise((resolve, reject) => {
      let formData;
      let progressCallback = onProgress;

      if (fileOrFormData instanceof FormData) {
        formData = fileOrFormData;
        progressCallback = metaOrProgress;
      } else {
        formData = new FormData();
        formData.append('file', fileOrFormData);
        if (metaOrProgress && typeof metaOrProgress === 'object') {
          if (metaOrProgress.title) formData.append('title', metaOrProgress.title);
          if (metaOrProgress.description) formData.append('description', metaOrProgress.description);
          if (metaOrProgress.tags) {
            const tagsStr = Array.isArray(metaOrProgress.tags) ? metaOrProgress.tags.join(',') : metaOrProgress.tags;
            formData.append('tags', tagsStr);
          }
        }
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/upload`, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && progressCallback) {
          const percent = Math.round((e.loaded / e.total) * 100);
          progressCallback(percent, e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data.data);
          } else {
            reject(new Error(data.error?.message || data.message || `Lỗi tải lên (${xhr.status})`));
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
   * Chuẩn hóa URL sang Origin hiện tại nếu cùng server
   */
  normalizeUploadUrl(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url);
      const currentOrigin = new URL(window.location.origin);
      if (parsed.hostname !== currentOrigin.hostname) {
        parsed.protocol = currentOrigin.protocol;
        parsed.host = currentOrigin.host;
        parsed.port = currentOrigin.port;
        return parsed.toString();
      }
    } catch (e) {
      console.warn('URL parse fallback:', e);
    }
    return url;
  },

  /**
   * Khởi tạo S3 Multipart Upload
   */
  async initiateMultipartUpload(payload) {
    const res = await fetch(`${API_BASE}/multipart/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || data.message || 'Lỗi khởi tạo Multipart Upload');
    return data.data;
  },

  /**
   * Lấy Presigned URL cho 1 Part
   */
  async getMultipartPartUrl(videoId, payload) {
    const res = await fetch(`${API_BASE}/multipart/${videoId}/part-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || data.message || 'Lỗi lấy Presigned URL cho part');
    return data.data;
  },

  /**
   * Hoàn tất ghép S3 Multipart Upload
   */
  async completeMultipartUpload(videoId, payload) {
    const res = await fetch(`${API_BASE}/multipart/${videoId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || data.message || 'Lỗi hoàn tất ghép video');
    return data.data;
  },

  /**
   * Hủy S3 Multipart Upload
   */
  async abortMultipartUpload(videoId, payload) {
    try {
      await fetch(`${API_BASE}/multipart/${videoId}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn('Abort upload error:', e);
    }
  },

  /**
   * Upload video dung lượng lớn (2GB+) theo cơ chế S3 Multipart / Chunks
   * (Mỗi chunk 15MB, vượt qua giới hạn 100MB Cloudflare & không tràn RAM)
   */
  async uploadLargeVideoMultipart(file, meta, onProgress) {
    if (!file) throw new Error('Không tìm thấy file để upload');

    const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB mỗi chunk
    const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    
    // 1. Khởi tạo Multipart Upload
    const initData = await this.initiateMultipartUpload({
      title: meta.title,
      description: meta.description || '',
      tags: meta.tags || [],
      originalFilename: file.name,
      mimeType: file.type || 'video/mp4',
      fileSizeBytes: file.size,
    });

    const videoId = initData.videoId;
    const uploadId = initData.uploadId;
    const uploadedParts = [];

    try {
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        // Lấy Presigned URL cho part này
        const partUrlData = await this.getMultipartPartUrl(videoId, {
          uploadId,
          partNumber,
        });

        const targetUrl = this.normalizeUploadUrl(partUrlData.presignedUrl);

        // Upload chunk qua XHR để bắt ETag và theo dõi tiến trình
        const etag = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', targetUrl, true);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
              const currentChunkLoaded = e.loaded;
              const totalLoadedSoFar = start + currentChunkLoaded;
              const overallPercent = Math.min(99, Math.round((totalLoadedSoFar / file.size) * 100));
              onProgress({
                percent: overallPercent,
                partNumber,
                totalParts,
                loaded: totalLoadedSoFar,
                total: file.size,
              });
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              let rawETag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
              if (!rawETag) {
                // Một số proxy có thể không trả ETag header, fallback lấy từ response
                rawETag = `"${partNumber}"`;
              }
              resolve(rawETag.replace(/^W\//, '')); // Loại bỏ Weak ETag nếu có
            } else {
              reject(new Error(`Tải lên mảnh ${partNumber}/${totalParts} thất bại (HTTP ${xhr.status})`));
            }
          };

          xhr.onerror = () => reject(new Error(`Lỗi kết nối mạng khi tải lên mảnh ${partNumber}/${totalParts}`));
          xhr.send(chunk);
        });

        uploadedParts.push({
          PartNumber: partNumber,
          ETag: etag,
        });

        if (onProgress) {
          const totalLoadedSoFar = end;
          const overallPercent = Math.min(99, Math.round((totalLoadedSoFar / file.size) * 100));
          onProgress({
            percent: overallPercent,
            partNumber,
            totalParts,
            loaded: totalLoadedSoFar,
            total: file.size,
          });
        }
      }

      // 3. Hoàn tất ghép file Multipart trên MinIO
      if (onProgress) {
        onProgress({
          percent: 99,
          partNumber: totalParts,
          totalParts,
          isCompleting: true,
        });
      }

      const completeRes = await this.completeMultipartUpload(videoId, {
        uploadId,
        parts: uploadedParts,
        fileSizeBytes: file.size,
      });

      if (onProgress) {
        onProgress({
          percent: 100,
          partNumber: totalParts,
          totalParts,
          isFinished: true,
        });
      }

      return completeRes;
    } catch (err) {
      // Hủy multipart upload dở dang để giải phóng dung lượng MinIO
      await this.abortMultipartUpload(videoId, { uploadId });
      throw err;
    }
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
      const targetUrl = this.normalizeUploadUrl(uploadUrl);
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
