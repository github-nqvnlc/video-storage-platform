# 🌪️ WINDY STORAGE - NỀN TẢNG LƯU TRỮ, XỬ LÝ & PHÂN PHỐI VIDEO HLS

> Hệ thống lưu trữ, phân phối và quản lý video chuẩn **HLS Adaptive Bitrate (ABR)** toàn diện, xây dựng trên nền tảng **NestJS**, **MinIO (Self-hosted S3)**, **PostgreSQL**, **Redis (BullMQ)**, **FFmpeg**, **Meilisearch**, **Nginx Reverse Proxy & Cache** và **Cloudflare Tunnel**.

---

## 📑 MỤC LỤC
1. [Kiến Trúc Hệ Thống & Tính Năng](#1-kiến-trúc-hệ-thống--tính-năng)
2. [Cấu Trúc Thư Mục Dự Án](#2-cấu-trúc-thư-mục-dự-án)
3. [Yêu Cầu Môi Trường (Prerequisites)](#3-yêu-cầu-môi-trường-prerequisites)
4. [Hướng Dẫn Cấu Hình File Môi Trường (.env)](#4-hướng-dẫn-cấu-hình-file-môi-trường-env)
5. [Hướng Dẫn Triển Khai Nhanh Với Docker (Khuyến nghị)](#5-hướng-dẫn-triển-khai-nhanh-với-docker-khuyến-nghị)
6. [Hướng Dẫn Chạy Môi Trường Phát Triển Local (Dev Mode)](#6-hướng-dẫn-chạy-môi-trường-phát-triển-local-dev-mode)
7. [Các Cổng Truy Cập & Endpoint Quan Trọng](#7-các-cổng-truy-cập--endpoint-quan-trọng)
8. [Hướng Dẫn Sử Dụng Tính Năng Nhúng Web & Share URL](#8-hướng-dẫn-sử-dụng-tính-năng-nhúng-web--share-url)
9. [Các Lệnh Vận Hành, Bảo Trì & Xử Lý Sự Cố Thường Gặp](#9-các-lệnh-vận-hành-bảo-trì--xử-lý-sự-cố-thường-gặp)

---

## 1. KIẾN TRÚC HỆ THỐNG & TÍNH NĂNG

Hệ thống được thiết kế theo mô hình Microservices phân tán với **8 Docker Containers**:

```
[ Người Dùng / Trình Duyệt ]
             │
             ▼ (HTTPS)
 [ Cloudflare Tunnel (windy-tunnel) ]
             │
             ▼ (Port 80)
    [ Nginx Reverse Proxy (windy-nginx) ]
    ├── /           ──> [ Frontend SPA + HLS.js + Embed Player ]
    ├── /api/       ──> [ NestJS API Gateway (windy-api) ]
    │                        ├── [ PostgreSQL (windy-postgres) ] (Metadata)
    │                        ├── [ Redis (windy-redis) ] (Queue & Cache)
    │                        └── [ Meilisearch (windy-meilisearch) ] (Search)
    └── /storage/   ──> [ MinIO S3 Object Storage (windy-minio) ]
                             ├── raw-videos (Bucket lưu video gốc)
                             └── hls-videos (Bucket lưu luồng .m3u8 & .ts)
                                   ▲
                                   │ Upload phân đoạn
                    [ Transcoder Worker (windy-worker + FFmpeg) ]
```

### ✨ Các tính năng nổi bật:
* **Frontend SPA Dark Glassmorphism:** Giao diện tối ưu, hiện đại, có chế độ xem **Lưới (Grid 3/4/5/6 Cột)** và **Danh sách (List Nhỏ/Vừa/To)**.
* **HLS Multi-Bitrate Transcoding:** Tự động cắt video gốc thành nhiều profile độ phân giải (`1080p`, `720p`, `480p`, `360p`) kèm file `master.m3u8`.
* **Xử lý Video Không Tiếng (Silent Video):** Tự động nhận diện video không có track âm thanh để xuất luồng HLS Video-Only không bị lỗi.
* **Thử Lại (Retry Transcode):** Nút thử lại 1-click trực quan trên giao diện khi video bị lỗi hoặc treo.
* **Xuất URL Xem Trước & Mã Nhúng Web (Embed Code Generator):**
  * Tự động sinh mã `<iframe>` nhúng vào WordPress/Landing Page.
  * Hỗ trợ tùy biến: Tự động phát (`autoplay`), Tắt tiếng (`muted`), Lặp vô hạn (`infinite loop`) hoặc Lặp có số lần định trước (`loopCount`).
  * Trang `embed.html` độc lập, siêu nhẹ.
* **Tìm Kiếm Tức Thì (Meilisearch):** Tìm video theo tiêu đề, mô tả, tags siêu tốc, hỗ trợ tiếng Việt có/không dấu và chống lỗi gõ phím.
* **Bảo Mật & Zero-Trust với Cloudflare Tunnel:** Không cần mở port router, tự động cấp SSL HTTPS miễn phí.

---

## 2. CẤU TRÚC THƯ MỤC DỰ ÁN

```
windy-storage/
├── docker/
│   └── nginx/
│       └── nginx.conf         # Cấu hình Nginx reverse proxy, cache HLS, CORS & no-cache
├── frontend/
│   ├── index.html             # Giao diện chính Single Page Application
│   ├── embed.html             # Trang nhúng Player standalone siêu nhẹ
│   ├── css/
│   │   └── style.css          # Design system Glassmorphism & responsive layout
│   └── js/
│       ├── api.js             # API Client giao tiếp với NestJS backend
│       ├── player.js          # Engine phát video HLS.js Adaptive Bitrate
│       └── app.js             # Controller chính (View switcher, share modal, CRUD)
├── prisma/
│   └── schema.prisma          # Database Schema cho PostgreSQL
├── src/
│   ├── main.ts                # Bootstrap cho API Server
│   ├── worker.ts              # Bootstrap cho Transcoder Worker
│   ├── modules/
│   │   ├── videos/            # Controller & Service quản lý CRUD, Upload, Retry
│   │   ├── minio/             # Service kết nối và quản lý S3 Buckets
│   │   ├── search/            # Service đồng bộ và tìm kiếm Meilisearch
│   │   ├── queue/             # Service quản lý hàng đợi BullMQ (Redis)
│   │   └── prisma/            # Prisma Database Client
│   └── worker/
│       ├── ffmpeg.service.ts  # Bộ xử lý ffprobe, multi-bitrate HLS, thumbnail, preview
│       └── transcode.processor.ts # BullMQ Consumer xử lý tác vụ transcode ngầm
├── docker-compose.yml         # Định nghĩa toàn bộ 8 services Docker
├── Dockerfile.api             # Multi-stage build cho API Server
├── Dockerfile.worker          # Build cho Worker (chứa Alpine + Node 20 + FFmpeg)
├── package.json
└── README.md
```

---

## 3. YÊU CẦU MÔI TRƯỜNG (PREREQUISITES)

* **Hệ điều hành:** Linux (Ubuntu/Debian/CentOS), macOS hoặc Windows (WSL2).
* **Docker:** Docker Engine >= 24.0
* **Docker Compose:** Docker Compose V2 (`docker compose version`)
* **Phần cứng tối thiểu:**
  * CPU: 2 Cores (Khuyến nghị 4 Cores để transcode video nhanh)
  * RAM: 4GB (Khuyến nghị 8GB)
  * Disk: Tối thiểu 20GB dung lượng trống

---

## 4. HƯỚNG DẪN CẤU HÌNH FILE MÔI TRƯỜNG (.env)

Tạo file `.env` tại thư mục gốc của dự án:

```bash
cp .env.example .env
```

Nội dung file `.env` chuẩn mẫu:

```ini
# ==============================================================================
# CẤU HÌNH DOMAIN & PUBLIC URL
# ==============================================================================
PORT=3000
NODE_ENV=production
PUBLIC_API_URL=https://video-storage.locnv.id.vn
APP_PUBLIC_URL=https://video-storage.locnv.id.vn

# ==============================================================================
# DATABASE (PostgreSQL)
# ==============================================================================
POSTGRES_USER=windy_user
POSTGRES_PASSWORD=windy_secure_password_2026
POSTGRES_DB=windy_video_db
DATABASE_URL="postgresql://windy_user:windy_secure_password_2026@postgres:5432/windy_video_db?schema=public"

# ==============================================================================
# REDIS (BullMQ & Cache)
# ==============================================================================
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_secure_password_2026

# ==============================================================================
# MINIO (S3 Object Storage)
# ==============================================================================
MINIO_ENDPOINT=http://minio:9000
MINIO_PUBLIC_URL=https://video-storage.locnv.id.vn/storage
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minio_secure_password_2026
MINIO_RAW_BUCKET=raw-videos
MINIO_HLS_BUCKET=hls-videos

# ==============================================================================
# MEILISEARCH (Search Engine)
# ==============================================================================
MEILISEARCH_HOST=http://meilisearch:7700
MEILI_MASTER_KEY=meili_master_key_123456

# ==============================================================================
# CLOUDFLARE TUNNEL (Public Domain Deployment)
# ==============================================================================
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiMDIz... (Điền Token Cloudflare của bạn tại đây)
```

---

## 5. HƯỚNG DẪN TRIỂN KHAI NHANH VỚI DOCKER (KHUYẾN NGHỊ)

### Bước 1: Tạo các thư mục lưu trữ dữ liệu bền vững (Persistent Data)
```bash
mkdir -p data/postgres data/redis data/minio data/meilisearch data/nginx_cache
```

### Bước 2: Build và khởi động toàn bộ 8 containers
```bash
docker compose up -d --build
```

### Bước 3: Đồng bộ Database Schema (Prisma DB Push)
```bash
docker compose exec api npx prisma db push
```

### Bước 4: Kiểm tra trạng thái hệ thống
```bash
docker compose ps
```
Đảm bảo tất cả 8 container đều hiển thị `Up` hoặc `Healthy`:
* `windy-postgres` (healthy)
* `windy-redis` (healthy)
* `windy-minio` (running)
* `windy-meilisearch` (running)
* `windy-api` (running)
* `windy-worker` (running)
* `windy-nginx` (running)
* `windy-tunnel` (running)

---

## 6. HƯỚNG DẪN CHẠY MÔI TRƯỜNG PHÁT TRIỂN LOCAL (DEV MODE)

Nếu bạn muốn chỉnh sửa và phát triển mã nguồn trực tiếp trên máy không thông qua container build:

```bash
# 1. Cài đặt thư viện
npm install

# 2. Khởi chạy 4 service nền (Postgres, Redis, MinIO, Meilisearch)
docker compose up -d postgres redis minio meilisearch

# 3. Chạy Prisma Generate & Push schema
npx prisma generate
npx prisma db push

# 4. Khởi chạy API Server (Terminal 1)
npm run start:dev

# 5. Khởi chạy FFmpeg Transcoder Worker (Terminal 2)
npm run start:worker:dev
```

---

## 7. CÁC CỔNG TRUY CẬP & ENDPOINT QUAN TRỌNG

| Dịch vụ | Đường dẫn truy cập | Tài khoản / Ghi chú |
| :--- | :--- | :--- |
| **Giao diện Web chính (SPA)** | `https://video-storage.locnv.id.vn` hoặc `http://localhost` | Giao diện Dark Glassmorphism |
| **Trang Nhúng Standalone** | `https://video-storage.locnv.id.vn/embed.html?v=<id>` | Trình phát video độc lập siêu nhẹ |
| **Swagger API Documentation** | `https://video-storage.locnv.id.vn/api/v1/docs` | Đầy đủ tài liệu & Test API trực tiếp |
| **MinIO Web Console** | `http://localhost:9001` | User: `minioadmin` / Pass: `minio_secure_password_2026` |
| **Meilisearch Dashboard** | `http://localhost:7700` | Master Key: `meili_master_key_123456` |

---

## 8. HƯỚNG DẪN SỬ DỤNG TÍNH NĂNG NHÚNG WEB & SHARE URL

### 1. Nhúng Iframe vào Website (WordPress, Blog, Landing Page)
```html
<iframe 
  src="https://video-storage.locnv.id.vn/embed.html?v=VIDEO_ID&autoplay=1&muted=1&loop=infinite" 
  width="100%" 
  height="450" 
  frameborder="0" 
  allow="autoplay; fullscreen" 
  allowfullscreen>
</iframe>
```

### 2. Các tham số URL tùy biến trên `embed.html`:
* `v`: ID của video (`e0d33312-...`).
* `autoplay=1`: Tự động phát khi tải trang (*trình duyệt sẽ tự động mute để tuân thủ autoplay policy*).
* `muted=1`: Tắt tiếng mặc định.
* `controls=0`: Ẩn thanh điều khiển (play/pause/volume).
* `loop=infinite`: Tự động lặp lại video vô hạn lần.
* `loopCount=3`: Lặp lại đúng số lần định trước (ví dụ 3 lần) rồi dừng lại.

### 3. Nhúng Trực Tiếp Bằng HLS.js Snippet:
```html
<div style="position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:12px;overflow:hidden;">
  <video id="myPlayer" style="position:absolute;top:0;left:0;width:100%;height:100%;" controls autoplay muted playsinline></video>
</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
  const video = document.getElementById('myPlayer');
  const streamUrl = 'https://video-storage.locnv.id.vn/storage/hls-videos/VIDEO_ID/master.m3u8';
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
  }
</script>
```

---

## 9. CÁC LỆNH VẬN HÀNH, BẢO TRÌ & XỬ LÝ SỰ CỐ THƯỜNG GẶP

### 1. Xem nhật ký log của hệ thống:
```bash
# Xem log realtime của Transcoder Worker (quá trình FFmpeg chạy)
docker logs -f --tail 100 windy-worker

# Xem log của API Server
docker logs -f --tail 100 windy-api

# Xem log của Nginx & Cloudflare Tunnel
docker logs -f --tail 50 windy-nginx
docker logs -f --tail 50 windy-tunnel
```

### 2. Khởi động lại hoặc cập nhật Frontend / Nginx:
```bash
docker compose restart nginx
```

### 3. Re-build lại API hoặc Worker khi sửa đổi mã nguồn TypeScript:
```bash
# Build lại Worker
docker compose build worker && docker compose up -d worker

# Build lại API
docker compose build api && docker compose up -d api
```

### 4. Xử lý lỗi xác thực mật khẩu PostgreSQL (nếu có):
Nếu gặp lỗi `Authentication failed for windy_user`, chạy lệnh sau để đồng bộ mật khẩu DB:
```bash
docker exec -i windy-postgres psql -U windy_user -d postgres -c "ALTER USER windy_user WITH PASSWORD 'windy_secure_password_2026';"
```

### 5. Dọn sạch dữ liệu và khởi động lại từ đầu (Clean Reset):
```bash
# Dừng và xóa toàn bộ container
docker compose down

# Xóa toàn bộ dữ liệu database, cache và minio (Cẩn thận: sẽ mất hết video đã tải lên)
rm -rf data/postgres/* data/redis/* data/minio/* data/meilisearch/* data/nginx_cache/*

# Khởi động lại hệ thống
docker compose up -d --build
docker compose exec api npx prisma db push
```

---

**Windy Storage © 2026 - High-Performance Video Delivery System**
