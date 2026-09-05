// frontend/js/app.js - Main Application Controller

/**
 * Xử lý escape HTML chống XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

let currentVideos = [];
let activeTag = null;
let activeSearchQuery = '';
let searchDebounceTimeout = null;
let onConfirmCallback = null;

// Quản lý trạng thái View Mode (Lưu & Khôi phục từ localStorage)
let currentViewMode = localStorage.getItem('windy_view_mode') || 'grid';
let currentGridCols = localStorage.getItem('windy_grid_cols') || '4';
let currentListSize = localStorage.getItem('windy_list_size') || 'medium';

// Khởi chạy ứng dụng khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initViewControls();
  initEventListeners();
  loadVideos();
  setupPollingForProcessingVideos();
});

/**
 * Khởi tạo & khôi phục các bộ điều khiển View Switcher
 */
function initViewControls() {
  const btnGrid = document.getElementById('btnViewGrid');
  const btnList = document.getElementById('btnViewList');
  const gridOptions = document.getElementById('gridOptionsWrapper');
  const listOptions = document.getElementById('listOptionsWrapper');
  const gridColsSelector = document.getElementById('gridColsSelector');
  const listSizeSelector = document.getElementById('listSizeSelector');

  if (gridColsSelector) gridColsSelector.value = currentGridCols;
  if (listSizeSelector) listSizeSelector.value = currentListSize;

  applyViewModeUI();

  if (btnGrid) {
    btnGrid.onclick = () => {
      currentViewMode = 'grid';
      localStorage.setItem('windy_view_mode', 'grid');
      applyViewModeUI();
      renderVideos(currentVideos);
    };
  }

  if (btnList) {
    btnList.onclick = () => {
      currentViewMode = 'list';
      localStorage.setItem('windy_view_mode', 'list');
      applyViewModeUI();
      renderVideos(currentVideos);
    };
  }

  if (gridColsSelector) {
    gridColsSelector.onchange = (e) => {
      currentGridCols = e.target.value;
      localStorage.setItem('windy_grid_cols', currentGridCols);
      renderVideos(currentVideos);
    };
  }

  if (listSizeSelector) {
    listSizeSelector.onchange = (e) => {
      currentListSize = e.target.value;
      localStorage.setItem('windy_list_size', currentListSize);
      renderVideos(currentVideos);
    };
  }
}

function applyViewModeUI() {
  const btnGrid = document.getElementById('btnViewGrid');
  const btnList = document.getElementById('btnViewList');
  const gridOptions = document.getElementById('gridOptionsWrapper');
  const listOptions = document.getElementById('listOptionsWrapper');

  if (currentViewMode === 'grid') {
    btnGrid?.classList.add('active');
    btnList?.classList.remove('active');
    if (gridOptions) gridOptions.style.display = 'block';
    if (listOptions) listOptions.style.display = 'none';
  } else {
    btnList?.classList.add('active');
    btnGrid?.classList.remove('active');
    if (gridOptions) gridOptions.style.display = 'none';
    if (listOptions) listOptions.style.display = 'block';
  }
}

/**
 * Đăng ký các sự kiện DOM
 */
function initEventListeners() {
  // Search input debounce
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimeout);
      activeSearchQuery = e.target.value.trim();
      searchDebounceTimeout = setTimeout(() => {
        loadVideos();
      }, 350);
    });
  }

  // Upload Modal triggers
  const btnOpenUpload = document.getElementById('btnOpenUpload');
  const closeUploadModal = document.getElementById('closeUploadModal');
  const cancelUploadBtn = document.getElementById('cancelUploadBtn');

  if (btnOpenUpload) btnOpenUpload.onclick = () => openModal('uploadModal');
  if (closeUploadModal) closeUploadModal.onclick = () => closeModal('uploadModal');
  if (cancelUploadBtn) cancelUploadBtn.onclick = () => closeModal('uploadModal');

  // Player Modal triggers
  const closePlayerModal = document.getElementById('closePlayerModal');
  if (closePlayerModal) {
    closePlayerModal.onclick = () => {
      if (typeof videoPlayerInstance !== 'undefined' && videoPlayerInstance.destroy) {
        videoPlayerInstance.destroy();
      }
      closeModal('playerModal');
    };
  }

  // Edit Modal triggers
  const closeEditModal = document.getElementById('closeEditModal');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (closeEditModal) closeEditModal.onclick = () => closeModal('editModal');
  if (cancelEditBtn) cancelEditBtn.onclick = () => closeModal('editModal');

  // Confirm Modal triggers
  const closeConfirmModal = document.getElementById('closeConfirmModal');
  const btnCancelConfirm = document.getElementById('btnCancelConfirm');
  const btnAcceptConfirm = document.getElementById('btnAcceptConfirm');

  if (closeConfirmModal) closeConfirmModal.onclick = () => closeModal('confirmModal');
  if (btnCancelConfirm) btnCancelConfirm.onclick = () => closeModal('confirmModal');
  if (btnAcceptConfirm) {
    btnAcceptConfirm.onclick = () => {
      if (typeof onConfirmCallback === 'function') {
        onConfirmCallback();
      }
    };
  }

  // Drag & Drop Upload
  setupUploadDropzone();

  // Upload Form Submit
  const uploadForm = document.getElementById('uploadForm');
  if (uploadForm) uploadForm.onsubmit = handleUploadSubmit;

  // Edit Form Submit
  const editForm = document.getElementById('editForm');
  if (editForm) editForm.onsubmit = handleEditSubmit;

  // Sort Selector Change
  const sortSelector = document.getElementById('sortSelector');
  if (sortSelector) {
    sortSelector.onchange = () => loadVideos();
  }

  // Đóng modal khi bấm vào nền backdrop
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'playerModal' && typeof videoPlayerInstance !== 'undefined' && videoPlayerInstance.destroy) {
          videoPlayerInstance.destroy();
        }
        closeModal(backdrop.id);
      }
    });
  });
}

/**
 * Tải danh sách video từ API
 */
async function loadVideos() {
  try {
    let result;
    if (activeSearchQuery) {
      result = await api.searchVideos({
        q: activeSearchQuery,
        tag: activeTag || undefined,
        limit: 50,
      });
    } else {
      result = await api.getVideos({
        tag: activeTag || undefined,
        limit: 50,
      });
    }

    currentVideos = result.items || [];
    updateHeroStats(currentVideos);
    renderVideos(currentVideos);
    renderTagPills(currentVideos);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Điều phối render danh sách Video theo chế độ Grid / List
 */
function renderVideos(videos) {
  const container = document.getElementById('videoGrid');
  const emptyState = document.getElementById('emptyState');

  if (!container) return;

  if (!videos || videos.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  if (currentViewMode === 'grid') {
    container.className = `video-grid cols-${currentGridCols}`;
    renderGridView(container, videos);
  } else {
    container.className = 'video-grid list-view';
    renderListView(container, videos);
  }
}

/**
 * 1. Chế độ xem Lưới (Grid View - 3, 4, 5, 6 Cột)
 */
function renderGridView(container, videos) {
  container.innerHTML = videos
    .map((video) => {
      const durationStr = formatDuration(video.durationSeconds);
      const thumbnailHtml = video.thumbnailUrl
        ? `<img src="${video.thumbnailUrl}" class="thumbnail-img" alt="${escapeHtml(video.title)}" loading="lazy">`
        : `<div class="thumbnail-placeholder"><i class="fas fa-film"></i></div>`;

      const statusBadge = `
        <span class="status-badge ${video.status.toLowerCase()}">
          <i class="fas ${getStatusIcon(video.status)}"></i> ${video.status}
        </span>
      `;

      const tagsHtml = (video.tags || [])
        .slice(0, 3)
        .map((t) => `<span class="video-tag-item">#${escapeHtml(t)}</span>`)
        .join('');

      const isFailed = video.status === 'FAILED' || video.status === 'DRAFT';
      const retryBtnHtml = isFailed
        ? `<button class="action-btn retry" title="Thử lại xử lý video" onclick="event.stopPropagation(); handleRetryVideo('${video.id}')">
            <i class="fas fa-redo-alt"></i>
          </button>`
        : '';

      return `
        <div class="video-card" data-id="${video.id}">
          <div class="thumbnail-wrapper" onclick="openVideoPlayer('${video.id}')">
            ${thumbnailHtml}
            ${statusBadge}
            ${video.durationSeconds > 0 ? `<span class="duration-badge">${durationStr}</span>` : ''}
            <div class="play-overlay">
              <div class="play-btn-circle">
                <i class="fas fa-play"></i>
              </div>
            </div>
          </div>
          <div class="video-card-body">
            <h3 class="video-card-title" onclick="openVideoPlayer('${video.id}')" title="${escapeHtml(video.title)}">
              ${escapeHtml(video.title)}
            </h3>
            <p class="video-card-desc">${escapeHtml(video.description || 'Chưa có mô tả')}</p>
            <div class="video-tags-container">${tagsHtml}</div>
            <div class="video-card-meta">
              <span><i class="fas fa-eye"></i> ${video.viewCount} views</span>
              <span><i class="far fa-clock"></i> ${formatRelativeTime(video.createdAt)}</span>
              <div class="video-card-actions">
                ${retryBtnHtml}
                <button class="action-btn" title="Xuất URL & Mã nhúng Web" onclick="event.stopPropagation(); openShareModal('${video.id}')">
                  <i class="fas fa-share-alt"></i>
                </button>
                <button class="action-btn" title="Chỉnh sửa" onclick="openEditModal('${video.id}')">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn delete" title="Xóa video" onclick="handleDeleteVideo('${video.id}')">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * 2. Chế độ xem Danh Sách (List View - Nhỏ, Vừa, To)
 */
function renderListView(container, videos) {
  container.innerHTML = videos
    .map((video) => {
      const durationStr = formatDuration(video.durationSeconds);
      const thumbnailHtml = video.thumbnailUrl
        ? `<img src="${video.thumbnailUrl}" class="thumbnail-img" alt="${escapeHtml(video.title)}" loading="lazy">`
        : `<div class="thumbnail-placeholder"><i class="fas fa-film"></i></div>`;

      const statusBadge = `
        <span class="status-badge ${video.status.toLowerCase()}" style="position: static; padding: 2px 8px; font-size: 10px;">
          <i class="fas ${getStatusIcon(video.status)}"></i> ${video.status}
        </span>
      `;

      const tagsHtml = (video.tags || [])
        .slice(0, 3)
        .map((t) => `<span class="video-tag-item">#${escapeHtml(t)}</span>`)
        .join('');

      const isFailed = video.status === 'FAILED' || video.status === 'DRAFT';
      const retryBtnHtml = isFailed
        ? `<button class="action-btn retry" title="Thử lại xử lý video" onclick="event.stopPropagation(); handleRetryVideo('${video.id}')">
            <i class="fas fa-redo-alt"></i>
          </button>`
        : '';

      const actionsHtml = `
        <div class="list-actions">
          ${retryBtnHtml}
          <button class="action-btn" title="Xuất URL & Mã nhúng Web" onclick="event.stopPropagation(); openShareModal('${video.id}')">
            <i class="fas fa-share-alt"></i>
          </button>
          <button class="action-btn" title="Chỉnh sửa" onclick="openEditModal('${video.id}')">
            <i class="fas fa-edit"></i>
          </button>
          <button class="action-btn delete" title="Xóa video" onclick="handleDeleteVideo('${video.id}')">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      `;

      // --- DẠNG 1: SIZE NHỎ (Compact - Không thumbnail, 1 dòng mô tả) ---
      if (currentListSize === 'small') {
        return `
          <div class="video-list-item small" data-id="${video.id}">
            <div class="list-icon-btn" onclick="openVideoPlayer('${video.id}')" title="Phát video">
              <i class="fas fa-play"></i>
            </div>
            <div class="list-content">
              <div class="list-title-box">
                <div class="list-title" onclick="openVideoPlayer('${video.id}')" title="${escapeHtml(video.title)}">
                  ${escapeHtml(video.title)}
                </div>
                <div class="list-desc">${escapeHtml(video.description || 'Chưa có mô tả')}</div>
              </div>
              <div class="list-meta">
                ${statusBadge}
                ${video.durationSeconds > 0 ? `<span><i class="far fa-clock"></i> ${durationStr}</span>` : ''}
                <span><i class="fas fa-eye"></i> ${video.viewCount} views</span>
                <span>${formatRelativeTime(video.createdAt)}</span>
              </div>
            </div>
            ${actionsHtml}
          </div>
        `;
      }

      // --- DẠNG 2: SIZE VỪA (Medium - Thumbnail nhỏ ~140px, 2 dòng mô tả) ---
      if (currentListSize === 'medium') {
        return `
          <div class="video-list-item medium" data-id="${video.id}">
            <div class="list-thumb-wrapper" onclick="openVideoPlayer('${video.id}')">
              ${thumbnailHtml}
              ${video.durationSeconds > 0 ? `<span class="duration-badge">${durationStr}</span>` : ''}
              <div class="play-overlay">
                <div class="play-btn-circle" style="width: 36px; height: 36px; font-size: 14px;">
                  <i class="fas fa-play"></i>
                </div>
              </div>
            </div>
            <div class="list-content">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <h3 class="list-title" onclick="openVideoPlayer('${video.id}')" title="${escapeHtml(video.title)}">
                  ${escapeHtml(video.title)}
                </h3>
                ${statusBadge}
              </div>
              <p class="list-desc">${escapeHtml(video.description || 'Chưa có mô tả')}</p>
              <div class="list-meta">
                <div class="video-tags-container" style="margin-bottom: 0;">${tagsHtml}</div>
                <span><i class="fas fa-eye"></i> ${video.viewCount} views</span>
                <span><i class="far fa-calendar-alt"></i> ${formatRelativeTime(video.createdAt)}</span>
              </div>
            </div>
            ${actionsHtml}
          </div>
        `;
      }

      // --- DẠNG 3: SIZE TO (Large - Thumbnail to ~240px, 3 dòng mô tả, đầy đủ) ---
      return `
        <div class="video-list-item large" data-id="${video.id}">
          <div class="list-thumb-wrapper" onclick="openVideoPlayer('${video.id}')">
            ${thumbnailHtml}
            ${video.durationSeconds > 0 ? `<span class="duration-badge">${durationStr}</span>` : ''}
            <div class="play-overlay">
              <div class="play-btn-circle">
                <i class="fas fa-play"></i>
              </div>
            </div>
          </div>
          <div class="list-content">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <h3 class="list-title" onclick="openVideoPlayer('${video.id}')" title="${escapeHtml(video.title)}">
                ${escapeHtml(video.title)}
              </h3>
              ${statusBadge}
            </div>
            <p class="list-desc">${escapeHtml(video.description || 'Chưa có mô tả')}</p>
            <div class="video-tags-container">${tagsHtml}</div>
            <div class="list-meta">
              <div style="display: flex; gap: 16px;">
                <span><i class="fas fa-eye"></i> ${video.viewCount} lượt xem</span>
                <span><i class="far fa-clock"></i> Thời lượng: ${durationStr}</span>
                <span><i class="far fa-calendar-alt"></i> ${new Date(video.createdAt).toLocaleDateString('vi-VN')}</span>
              </div>
              ${actionsHtml}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Render thanh Tag Filter Pills
 */
function renderTagPills(videos) {
  const container = document.getElementById('tagPills');
  if (!container) return;

  const tagSet = new Set();
  videos.forEach((v) => {
    if (v.tags && Array.isArray(v.tags)) {
      v.tags.forEach((t) => tagSet.add(t));
    }
  });

  let html = `<div class="pill ${!activeTag ? 'active' : ''}" onclick="selectTag(null)">Tất cả</div>`;
  tagSet.forEach((tag) => {
    html += `<div class="pill ${activeTag === tag ? 'active' : ''}" onclick="selectTag('${tag}')">#${escapeHtml(tag)}</div>`;
  });

  container.innerHTML = html;
}

function selectTag(tag) {
  activeTag = tag;
  loadVideos();
}

/**
 * Mở Player Modal và phát HLS Stream
 */
async function openVideoPlayer(videoId) {
  const video = currentVideos.find((v) => v.id === videoId);
  if (!video) return;

  if (video.status === 'PROCESSING' || video.status === 'DRAFT') {
    showToast('Video đang được worker xử lý cắt HLS, vui lòng đợi giây lát...', 'info');
    return;
  }
  if (video.status === 'FAILED') {
    showToast(`Video transcode thất bại: ${video.failureReason || 'Lỗi không xác định'}`, 'error');
    return;
  }

  document.getElementById('playerTitle').textContent = video.title;
  document.getElementById('playerDesc').textContent = video.description || 'Không có mô tả chi tiết.';
  document.getElementById('playerViews').textContent = `${video.viewCount} lượt xem`;
  document.getElementById('playerDate').textContent = new Date(video.createdAt).toLocaleDateString('vi-VN');

  openModal('playerModal');
  videoPlayerInstance.loadStream(video.hlsMasterUrl, video.id);
  api.incrementView(video.id);
}

/**
 * Xử lý Drag & Drop Upload
 */
let selectedFile = null;

function setupUploadDropzone() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('videoFileInput');

  if (!dropzone || !fileInput) return;

  dropzone.onclick = () => fileInput.click();

  fileInput.onchange = (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  };

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });
}

function handleFileSelected(file) {
  selectedFile = file;
  const fileNameDisplay = document.getElementById('selectedFileName');
  const uploadTitleInput = document.getElementById('uploadTitle');

  if (fileNameDisplay) {
    fileNameDisplay.textContent = `📁 Đã chọn: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  }

  if (uploadTitleInput && !uploadTitleInput.value.trim()) {
    const rawName = file.name.replace(/\.[^/.]+$/, '');
    uploadTitleInput.value = rawName;
  }
}

/**
 * Upload Video lên MinIO theo chuẩn S3 Multipart / Chunks (Hỗ trợ file 2GB+ không giới hạn RAM / Cloudflare)
 */
async function handleUploadSubmit(e) {
  e.preventDefault();

  if (!selectedFile) {
    showToast('Vui lòng chọn 1 file video để tải lên!', 'error');
    return;
  }

  const title = document.getElementById('uploadTitle').value.trim();
  const description = document.getElementById('uploadDesc').value.trim();
  const tagsStr = document.getElementById('uploadTags').value.trim();
  const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const progressContainer = document.getElementById('uploadProgressContainer');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressText = document.getElementById('uploadProgressText');
  const submitBtn = document.getElementById('btnSubmitUpload');

  if (progressContainer) progressContainer.style.display = 'block';
  if (submitBtn) submitBtn.disabled = true;

  try {
    const sizeInMB = (selectedFile.size / (1024 * 1024)).toFixed(1);
    this.logger?.log?.(`Bắt đầu tải video ${selectedFile.name} (${sizeInMB} MB)...`);

    await api.uploadLargeVideoMultipart(
      selectedFile,
      { title, description, tags },
      (info) => {
        if (progressFill) progressFill.style.width = `${info.percent}%`;
        if (progressText) {
          if (info.isCompleting) {
            progressText.textContent = `Đang hoàn tất ghép file trên MinIO (99%)...`;
          } else {
            const partInfo = info.totalParts > 1 ? ` (Mảnh ${info.partNumber}/${info.totalParts})` : '';
            progressText.textContent = `Đang tải lên MinIO${partInfo}: ${info.percent}%...`;
          }
        }
      },
    );

    showToast('Tải lên thành công! Worker đang tiến hành transcode HLS...', 'success');
    closeModal('uploadModal');
    resetUploadForm();
    loadVideos();
  } catch (error) {
    showToast(`Upload thất bại: ${error.message}`, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (progressContainer) progressContainer.style.display = 'none';
  }
}

function resetUploadForm() {
  selectedFile = null;
  const form = document.getElementById('uploadForm');
  const fileNameDisplay = document.getElementById('selectedFileName');
  const progressFill = document.getElementById('uploadProgressFill');

  if (form) form.reset();
  if (fileNameDisplay) fileNameDisplay.textContent = '';
  if (progressFill) progressFill.style.width = '0%';
}

/**
 * Chỉnh sửa Metadata Video
 */
let editingVideoId = null;

function openEditModal(videoId) {
  const video = currentVideos.find((v) => v.id === videoId);
  if (!video) return;

  editingVideoId = videoId;
  document.getElementById('editTitle').value = video.title;
  document.getElementById('editDesc').value = video.description || '';
  document.getElementById('editTags').value = (video.tags || []).join(', ');
  document.getElementById('editVisibility').value = video.visibility || 'PUBLIC';

  openModal('editModal');
}

async function handleEditSubmit(e) {
  e.preventDefault();
  if (!editingVideoId) return;

  const title = document.getElementById('editTitle').value.trim();
  const description = document.getElementById('editDesc').value.trim();
  const tagsStr = document.getElementById('editTags').value.trim();
  const visibility = document.getElementById('editVisibility').value;
  const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];

  try {
    await api.updateVideo(editingVideoId, { title, description, tags, visibility });
    showToast('Cập nhật thông tin video thành công!', 'success');
    closeModal('editModal');
    loadVideos();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Hiển thị Popup xác nhận (Custom Confirm Modal UI)
 */
function showConfirmModal({ title = 'Xác Nhận Xóa', message, acceptText = 'Xóa Vĩnh Viễn', onAccept }) {
  const modalTitle = document.getElementById('confirmModalTitle');
  const modalMsg = document.getElementById('confirmModalMessage');
  const btnAccept = document.getElementById('btnAcceptConfirm');

  if (modalTitle) {
    modalTitle.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <span>${escapeHtml(title)}</span>`;
  }
  if (modalMsg) {
    modalMsg.textContent = message;
  }
  if (btnAccept) {
    btnAccept.innerHTML = `<i class="fas fa-trash-alt"></i> <span>${escapeHtml(acceptText)}</span>`;
  }

  onConfirmCallback = onAccept;
  openModal('confirmModal');
}

/**
 * Xóa video với UI Popup Glassmorphism
 */
async function handleDeleteVideo(videoId) {
  showConfirmModal({
    title: 'Xác Nhận Xóa Video',
    message: 'Bạn có chắc chắn muốn xóa video này? Toàn bộ file video gốc và các phân đoạn stream HLS trên MinIO sẽ bị dọn sạch vĩnh viễn!',
    acceptText: 'Xóa Vĩnh Viễn',
    onAccept: async () => {
      try {
        await api.deleteVideo(videoId);
        showToast('Video đã được dọn sạch và xóa thành công!', 'success');
        closeModal('confirmModal');
        loadVideos();
      } catch (error) {
        showToast(error.message, 'error');
      }
    },
  });
}

/**
 * Thử lại transcode video bị lỗi (Retry)
 */
async function handleRetryVideo(videoId) {
  try {
    showToast('Đang kích hoạt lại tiến trình xử lý video...', 'info');
    await api.retryVideo(videoId);
    showToast('Đã đưa video vào hàng đợi transcode thành công!', 'success');
    loadVideos();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Cập nhật số liệu Hero Stats
 */
function updateHeroStats(videos) {
  const totalCount = videos.length;
  const readyCount = videos.filter((v) => v.status === 'READY').length;
  const processingCount = videos.filter((v) => v.status === 'PROCESSING').length;
  const totalViews = videos.reduce((acc, v) => acc + (parseInt(v.viewCount, 10) || 0), 0);

  const elTotal = document.getElementById('statTotalVideos');
  const elReady = document.getElementById('statReadyVideos');
  const elProcessing = document.getElementById('statProcessingVideos');
  const elViews = document.getElementById('statTotalViews');

  if (elTotal) elTotal.textContent = totalCount;
  if (elReady) elReady.textContent = readyCount;
  if (elProcessing) elProcessing.textContent = processingCount;
  if (elViews) elViews.textContent = totalViews.toLocaleString('vi-VN');
}

/**
 * Tự động thăm dò trạng thái các video đang PROCESSING
 */
function setupPollingForProcessingVideos() {
  setInterval(() => {
    const hasProcessing = currentVideos.some((v) => v.status === 'PROCESSING');
    if (hasProcessing) {
      loadVideos();
    }
  }, 4000);
}

/* Helper Functions */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('active'), 50);
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function getStatusIcon(status) {
  switch (status) {
    case 'READY': return 'fa-check-circle';
    case 'PROCESSING': return 'fa-spinner fa-spin';
    case 'FAILED': return 'fa-times-circle';
    default: return 'fa-clock';
  }
}

/* ==========================================================================
   Share & Embed Code Generator Logic
   ========================================================================== */
let sharingVideo = null;

function openShareModal(videoId) {
  const video = currentVideos.find((v) => v.id === videoId);
  if (!video) return;

  sharingVideo = video;

  // Render thông tin video trong header modal
  const thumbEl = document.getElementById('shareVideoThumb');
  if (thumbEl) {
    thumbEl.innerHTML = video.thumbnailUrl
      ? `<img src="${video.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover;">`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;"><i class="fas fa-film"></i></div>`;
  }
  const titleEl = document.getElementById('shareVideoTitle');
  if (titleEl) titleEl.textContent = video.title;

  const durationEl = document.getElementById('shareVideoDuration');
  if (durationEl) durationEl.textContent = `Thời lượng: ${formatDuration(video.durationSeconds)} • Lượt xem: ${video.viewCount}`;

  updateEmbedCodes();
  openModal('shareModal');
}

function updateEmbedCodes() {
  if (!sharingVideo) return;

  const isAutoplay = document.getElementById('optAutoplay')?.checked ?? true;
  const isMuted = document.getElementById('optMuted')?.checked ?? true;
  const isControls = document.getElementById('optControls')?.checked ?? true;
  const loopMode = document.getElementById('optLoopMode')?.value ?? 'infinite';
  const loopCountInput = document.getElementById('optLoopCount');
  const loopCount = parseInt(loopCountInput?.value, 10) || 3;

  if (loopCountInput) {
    loopCountInput.style.display = loopMode === 'custom' ? 'block' : 'none';
  }

  // Xây dựng Query Parameters
  const params = new URLSearchParams();
  params.set('v', sharingVideo.id);
  if (isAutoplay) params.set('autoplay', '1');
  if (isMuted) params.set('muted', '1');
  if (!isControls) params.set('controls', '0');

  if (loopMode === 'infinite') {
    params.set('loop', 'infinite');
  } else if (loopMode === 'custom') {
    params.set('loopCount', loopCount.toString());
  }

  const origin = window.location.origin;
  const embedUrl = `${origin}/embed.html?${params.toString()}`;

  // 1. Direct Share URL
  const shareDirectUrlEl = document.getElementById('shareDirectUrl');
  if (shareDirectUrlEl) shareDirectUrlEl.value = embedUrl;

  const btnOpenDirectLink = document.getElementById('btnOpenDirectLink');
  if (btnOpenDirectLink) btnOpenDirectLink.href = embedUrl;

  // 2. Iframe Embed Code
  const iframeCode = `<iframe src="${embedUrl}" width="100%" height="450" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
  const shareIframeCodeEl = document.getElementById('shareIframeCode');
  if (shareIframeCodeEl) shareIframeCodeEl.value = iframeCode;

  // 3. HLS Master URL
  let hlsUrl = sharingVideo.hlsMasterUrl || `${origin}/storage/hls-videos/${sharingVideo.id}/master.m3u8`;
  try {
    const parsed = new URL(hlsUrl);
    parsed.protocol = window.location.protocol;
    parsed.host = window.location.host;
    hlsUrl = parsed.toString();
  } catch(e) {}

  const shareHlsUrlEl = document.getElementById('shareHlsUrl');
  if (shareHlsUrlEl) shareHlsUrlEl.value = hlsUrl;

  // 4. HTML5 + HLS.js Snippet
  const htmlSnippet = `<!-- Windy Storage HLS Player Snippet -->
<div style="position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:12px;overflow:hidden;">
  <video id="windyPlayer" style="position:absolute;top:0;left:0;width:100%;height:100%;" ${isControls ? 'controls' : ''} ${isMuted || isAutoplay ? 'muted' : ''} playsinline></video>
</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
  (function() {
    const v = document.getElementById('windyPlayer');
    const src = '${hlsUrl}';
    let loops = 1, maxLoops = ${loopMode === 'infinite' ? -1 : (loopMode === 'custom' ? loopCount : 1)};
    v.addEventListener('ended', function() {
      if (maxLoops === -1 || loops < maxLoops) { loops++; v.play(); }
    });
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(v);
      ${isAutoplay ? 'hls.on(Hls.Events.MANIFEST_PARSED, function() { v.play(); });' : ''}
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src;
      ${isAutoplay ? 'v.addEventListener("loadedmetadata", function() { v.play(); });' : ''}
    }
  })();
</script>`;

  const shareHtmlSnippetEl = document.getElementById('shareHtmlSnippet');
  if (shareHtmlSnippetEl) shareHtmlSnippetEl.value = htmlSnippet;
}

/**
 * Sao chép mã vào Clipboard với hiệu ứng visual
 */
async function copyCodeFrom(elementId, btn) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const text = el.value || el.textContent;
  try {
    await navigator.clipboard.writeText(text);
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-check"></i> Đã Chép!`;
    btn.classList.add('copied');
    showToast('Đã sao chép vào bộ nhớ tạm!', 'success');

    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    el.select();
    document.execCommand('copy');
    showToast('Đã sao chép!', 'success');
  }
}

// Lắng nghe sự kiện đổi các Options trong Share Modal
document.addEventListener('DOMContentLoaded', () => {
  ['optAutoplay', 'optMuted', 'optControls', 'optLoopMode', 'optLoopCount'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', updateEmbedCodes);
      el.addEventListener('input', updateEmbedCodes);
    }
  });

  const closeShareModalBtn = document.getElementById('closeShareModal');
  if (closeShareModalBtn) {
    closeShareModalBtn.addEventListener('click', () => closeModal('shareModal'));
  }
});
