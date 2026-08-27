# THIẾT KẾ KIẾN TRÚC & KẾ HOẠCH TRIỂN KHAI HỆ THỐNG CRUDS VIDEO VỚI DOCKER TOÀN DIỆN
**Dự án:** Windy Storage Video Management System  
**Môi trường triển khai:** **Docker & Docker Compose (100% On-Premise / Local Host)**  
**Stack Công Nghệ:** **NestJS (API & Worker)** + **MinIO** + **PostgreSQL (Docker Local)** + **Redis (BullMQ)** + **FFmpeg** + **Meilisearch** + **Nginx**  
**Ngày cập nhật:** 2026-08-27  

---

## 1. TỔNG QUAN KIẾN TRÚC CONTAINER HÓA (DOCKER ARCHITECTURE)

Hệ thống được đóng gói thành một hệ sinh thái container khép kín, hoạt động độc lập trên máy chủ riêng (Dedicated Server / VPS / Local On-Premise):

```mermaid
flowchart TB
    subgraph HostServer ["Host Machine / Dedicated Server"]
        subgraph DiskStorage ["Host Disks Storage (Persistent Volumes)"]
            PGData["/data/postgres (Database Files)"]
            MinioData["/data/minio (Raw Videos & HLS Chunks)"]
            RedisData["/data/redis (Queue & State)"]
            MeiliData["/data/meilisearch (Search Indexes)"]
        end

        subgraph DockerNetwork ["Docker Network: windy-network"]
            Nginx["1. Nginx Reverse Proxy\n(Port 80 / 443)\n- Cache HLS Chunks .ts\n- Route /api -> NestJS\n- Route /storage -> MinIO"]
            
            NestAPI["2. NestJS API Server\n(Port 3000)\n- Auth, CRUD, Presigned URL"]
            
            NestWorker["3. Transcoding Worker Container\n(Node.js + FFmpeg Runtime)\n- BullMQ Consumer, HLS Encoding"]
            
            Postgres["4. PostgreSQL 16 Container\n(Port 5432)"]
            
            Redis["5. Redis 7 Container\n(Port 6379)"]
            
            MinIO["6. MinIO Storage Container\n(Port 9000 S3 / 9001 Console)"]
            
            Meili["7. Meilisearch Container\n(Port 7700)"]
        end
    end

    %% Storage Volume Mounts
    Postgres -.->|Mount| PGData
    MinIO -.->|Mount| MinioData
    Redis -.->|Mount| RedisData
    Meili -.->|Mount| MeiliData

    %% Traffic Routing
    Client(["Client Web / Mobile"]) -->|HTTP / HTTPS| Nginx
    Nginx -->|Proxy /api| NestAPI
    Nginx -->|Proxy /storage| MinIO
    Nginx -->|Proxy /console| MinIO

    %% Internal Communication
    NestAPI --> Postgres
    NestAPI --> Redis
    NestAPI --> Meili
    NestAPI -->|Presigned URL logic| MinIO

    Redis --> NestWorker
    NestWorker --> Postgres
    NestWorker --> MinIO
    NestWorker --> Meili
```

---

## 2. CÁC THÀNH PHẦN CONTAINER & VAI TRÒ

| Container Name | Service / Image | Vai trò & Đặc điểm | Volume Host Mount |
| :--- | :--- | :--- | :--- |
| **`windy-nginx`** | `nginx:alpine` | Cổng vào duy nhất (Gateway), SSL/TLS, Caching tĩnh các đoạn video `.ts` của HLS | `./docker/nginx/nginx.conf` |
| **`windy-api`** | `Dockerfile.api` (NestJS) | API Backend chính: Authentication, Metadata CRUD, cấp MinIO Presigned URL | Không cần mount (Stateless) |
| **`windy-worker`** | `Dockerfile.worker` (Node + FFmpeg) | Worker nền: Kéo video gốc từ MinIO, dùng FFmpeg cắt HLS đa bitrate và upload lại MinIO | Thư mục tạm `/tmp/transcode` |
| **`windy-postgres`**| `postgres:16-alpine` | Database cục bộ trong Docker: Lưu thông tin người dùng, metadata, logs | `./data/postgres` |
| **`windy-minio`** | `minio/minio` | S3-Compatible Object Storage trên ổ cứng cục bộ | `./data/minio` (ổ cứng lưu video) |
| **`windy-redis`** | `redis:7-alpine` | Quản lý Message Queue (BullMQ) và cache | `./data/redis` |
| **`windy-meilisearch`**| `getmeili/meilisearch:v1.8` | Search Engine tìm kiếm video tức thì | `./data/meilisearch` |

---

## 3. FILE CẤU HÌNH DOCKER CHI TIẾT

### 3.1. `docker-compose.yml` (Hạ tầng hoàn chỉnh)

```yaml
version: '3.8'

networks:
  windy-network:
    driver: bridge

services:
  # ============================================================================
  # 1. DATABASE & QUEUE INFRASTRUCTURE
  # ============================================================================
  postgres:
    image: postgres:16-alpine
    container_name: windy-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-windy_db}
      POSTGRES_USER: ${POSTGRES_USER:-windy_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-windy_secret_pass}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    networks:
      - windy-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-windy_user} -d ${POSTGRES_DB:-windy_db}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: windy-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-redis_secret_pass}
    volumes:
      - ./data/redis:/data
    networks:
      - windy-network
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-redis_secret_pass}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:RELEASE.2024-05-10T01-41-38Z
    container_name: windy-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minio_secret_pass}
      MINIO_SERVER_URL: ${MINIO_SERVER_URL:-http://localhost/storage}
    volumes:
      - ./data/minio:/data
    networks:
      - windy-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 15s
      timeout: 5s
      retries: 3

  meilisearch:
    image: getmeili/meilisearch:v1.8
    container_name: windy-meilisearch
    restart: unless-stopped
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-meili_master_key_123456}
      MEILI_ENV: production
      MEILI_NO_ANALYTICS: "true"
    volumes:
      - ./data/meilisearch:/meili_data
    networks:
      - windy-network

  # ============================================================================
  # 2. NESTJS APPLICATION & TRANSCODE WORKER
  # ============================================================================
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: windy-api
    restart: unless-stopped
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    networks:
      - windy-network

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    container_name: windy-worker
    restart: unless-stopped
    env_file:
      - .env
    deploy:
      resources:
        limits:
          cpus: '4.0'       # Giới hạn CPU tối đa cho FFmpeg
          memory: 4096M     # Giới hạn RAM tối đa cho Transcode
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    networks:
      - windy-network

  # ============================================================================
  # 3. NGINX REVERSE PROXY & STREAM CACHING
  # ============================================================================
  nginx:
    image: nginx:alpine
    container_name: windy-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./data/nginx_cache:/var/cache/nginx
    depends_on:
      - api
      - minio
    networks:
      - windy-network
```

---

### 3.2. `Dockerfile.api` (NestJS API Server)

```dockerfile
# Dockerfile.api
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

---

### 3.3. `Dockerfile.worker` (Worker tích hợp FFmpeg)

```dockerfile
# Dockerfile.worker
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# --- Production Stage with FFmpeg ---
FROM node:20-alpine AS runner

# Cài đặt FFmpeg và FFprobe trên Alpine Linux
RUN apk add --no-cache ffmpeg

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Chạy riêng tiến trình Worker
CMD ["node", "dist/worker/main.js"]
```

---

### 3.4. `docker/nginx/nginx.conf` (Tối ưu Cache HLS Video Chunks)

```nginx
events {
    worker_connections 1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    tcp_nopush     on;
    tcp_nodelay    on;
    keepalive_timeout  65;

    # Cấu hình bộ nhớ đệm Cache cho file HLS .ts
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=HLS_CACHE:100m inactive=24h max_size=10g;

    upstream nestjs_api {
        server api:3000;
    }

    upstream minio_s3 {
        server minio:9000;
    }

    upstream minio_console {
        server minio:9001;
    }

    server {
        listen 80;
        server_name localhost;
        client_max_body_size 5000M; # Cho phép upload file lớn

        # 1. API Route
        location /api/ {
            proxy_pass http://nestjs_api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # 2. MinIO S3 API & HLS Video Delivery (Có Cache)
        location /storage/ {
            proxy_pass http://minio_s3/;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

            # Caching riêng cho phân đoạn video HLS (.ts)
            location ~* \.ts$ {
                proxy_pass http://minio_s3;
                proxy_cache HLS_CACHE;
                proxy_cache_valid 200 24h;
                proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
                add_header X-Cache-Status $upstream_cache_status;
            }

            # Không cache playlist m3u8 để cập nhật tiến độ
            location ~* \.m3u8$ {
                proxy_pass http://minio_s3;
                add_header Cache-Control "no-cache, no-store";
            }
        }

        # 3. MinIO Web Console UI
        location /console/ {
            proxy_pass http://minio_console/;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

---

### 3.5. File Môi Trường Mẫu `.env`

```ini
# --- PostgreSQL Local ---
POSTGRES_DB=windy_video_db
POSTGRES_USER=windy_user
POSTGRES_PASSWORD=windy_secure_password_2026
DATABASE_URL="postgresql://windy_user:windy_secure_password_2026@postgres:5432/windy_video_db?schema=public"

# --- Redis & BullMQ ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_secure_password_2026

# --- MinIO Storage ---
MINIO_ENDPOINT=http://minio:9000
MINIO_PUBLIC_URL=http://localhost/storage
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minio_secure_password_2026
MINIO_RAW_BUCKET=raw-videos
MINIO_HLS_BUCKET=hls-videos

# --- Meilisearch ---
MEILISEARCH_HOST=http://meilisearch:7700
MEILISEARCH_API_KEY=meili_master_key_123456

# --- App Settings ---
PORT=3000
JWT_SECRET=super_secret_jwt_key_windy_storage
TRANSCODE_CONCURRENCY=2
```

---

## 4. QUẢN LÝ DỮ LIỆU & BACKUP ĐĨA CỨNG (ON-PREMISE STORAGE)

Khi chạy Local với Docker, toàn bộ dữ liệu nằm trong thư mục `./data/` trên máy chủ:

1. **Dữ liệu Database:** Nằm tại `./data/postgres/`
   * *Lệnh backup thủ công:*
     ```bash
     docker exec -t windy-postgres pg_dump -U windy_user windy_video_db > backup_$(date +%F).sql
     ```
2. **Dữ liệu Video & Chunks:** Nằm tại `./data/minio/`
   * Bạn có thể mount thư mục này vào một phân vùng đĩa cứng riêng (HDD/SSD/RAID/NFS) có dung lượng lớn:
     ```yaml
     volumes:
       - /mnt/storage_disk/minio_data:/data
     ```
3. **Dữ liệu Chỉ mục Tìm kiếm:** Nằm tại `./data/meilisearch/`

---

## 5. CÁC LỆNH VẬN HÀNH TOÀN DIỆN VỚI DOCKER

### 5.1. Khởi chạy toàn bộ hệ thống
```bash
# 1. Tạo các thư mục lưu trữ cục bộ
mkdir -p data/postgres data/redis data/minio data/meilisearch data/nginx_cache docker/nginx

# 2. Chạy migration Database với Prisma
docker compose run --rm api npx prisma migrate deploy

# 3. Khởi động toàn bộ container chạy ngầm
docker compose up -d --build
```

### 5.2. Kiểm tra trạng thái & Logs
```bash
# Xem trạng thái sức khỏe các container
docker compose ps

# Xem log xử lý transcode video thời gian thực
docker compose logs -f worker

# Xem log API
docker compose logs -f api
```

### 5.3. Dừng và khởi động lại
```bash
# Dừng an toàn (giữ nguyên dữ liệu)
docker compose down

# Khởi động lại
docker compose up -d
```
