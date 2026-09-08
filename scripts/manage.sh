#!/usr/bin/env bash
# ==============================================================================
# WINDY STORAGE - Docker & System Management CLI Menu
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Màu sắc hiển thị
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Hàm in tiêu đề
print_header() {
    clear 2>/dev/null || true
    echo -e "${CYAN}==============================================================================${NC}"
    echo -e "${BOLD}${CYAN}   🌊 WINDY STORAGE - HỆ THỐNG QUẢN TRỊ VIDEO STREAMING & MINIO S3${NC}"
    echo -e "${CYAN}==============================================================================${NC}"
    echo -e " Thư mục dự án: ${YELLOW}$PROJECT_DIR${NC}"
    if [ -f "$PROJECT_DIR/.env" ]; then
        source "$PROJECT_DIR/.env" 2>/dev/null || true
        echo -e " Public Video Domain: ${GREEN}${PUBLIC_BASE_URL:-https://video.investinlamdong.vn}${NC} | MinIO Port: ${YELLOW}9101 (Console)${NC}"
    else
        echo -e " Trạng thái .env: ${RED}Chưa tìm thấy .env!${NC}"
    fi
    echo -e "${CYAN}------------------------------------------------------------------------------${NC}"
}

# ==============================================================================
# 1. Dashboard Docker & Trạng thái hệ thống
# ==============================================================================
show_dashboard() {
    print_header
    echo -e "\n${BOLD}${BLUE}📊 [1] DASHBOARD TRẠNG THÁI TOÀN BỘ 8 SERVICES DOCKER:${NC}\n"
    
    if ! docker compose ps >/dev/null 2>&1; then
        echo -e "${RED}❌ Không thể kết nối tới Docker daemon hoặc chưa khởi động dịch vụ.${NC}"
        return
    fi

    echo -e "${BOLD}Danh sách Containers:${NC}"
    docker compose ps
    echo ""

    echo -e "${BOLD}Mức tiêu hao tài nguyên (CPU / RAM):${NC}"
    docker stats --no-stream $(docker compose ps -q) 2>/dev/null || echo -e "${YELLOW}Không có container nào đang chạy.${NC}"
    echo ""

    echo -e "${BOLD}Kiểm tra kết nối các dịch vụ cốt lõi:${NC}"
    
    # Nginx check (Port 80)
    if curl -s -I "http://localhost:80/" >/dev/null 2>&1; then
        echo -e " - Nginx Web & HLS Proxy (Port 80)         : ${GREEN}● ONLINE (200 OK)${NC}"
    else
        echo -e " - Nginx Web & HLS Proxy (Port 80)         : ${RED}● OFFLINE${NC}"
    fi

    # API check
    if curl -s "http://localhost:80/api/health" >/dev/null 2>&1 || curl -s "http://localhost:80/api/videos" >/dev/null 2>&1; then
        echo -e " - NestJS API Server                       : ${GREEN}● ONLINE (Sẵn sàng)${NC}"
    else
        echo -e " - NestJS API Server                       : ${YELLOW}○ Đang khởi động hoặc cần kiểm tra logs${NC}"
    fi

    # MinIO S3 API & Console (Port 9100 / 9101)
    if curl -s -I "http://localhost:9100/minio/health/live" >/dev/null 2>&1 || nc -z 127.0.0.1 9100 2>/dev/null; then
        echo -e " - MinIO S3 API (Port 9100)                : ${GREEN}● ONLINE${NC}"
    else
        echo -e " - MinIO S3 API (Port 9100)                : ${RED}● OFFLINE${NC}"
    fi

    if nc -z 127.0.0.1 9101 2>/dev/null || curl -s -I "http://localhost:9101/" >/dev/null 2>&1; then
        echo -e " - MinIO Web Console (Port 9101)           : ${GREEN}● ONLINE (http://localhost:9101)${NC}"
    else
        echo -e " - MinIO Web Console (Port 9101)           : ${RED}● OFFLINE${NC}"
    fi

    # Meilisearch (Port 7701)
    if curl -s "http://localhost:7701/health" >/dev/null 2>&1; then
        echo -e " - Meilisearch Engine (Port 7701)          : ${GREEN}● ONLINE (Healthy)${NC}"
    else
        echo -e " - Meilisearch Engine (Port 7701)          : ${RED}● OFFLINE${NC}"
    fi

    # Redis (Port 6380)
    if docker exec windy-redis redis-cli ping >/dev/null 2>&1; then
        echo -e " - Redis BullMQ Queue (Port 6380)          : ${GREEN}● ONLINE (PONG)${NC}"
    else
        echo -e " - Redis BullMQ Queue (Port 6380)          : ${RED}● OFFLINE${NC}"
    fi

    # PostgreSQL (Port 5433)
    if docker exec windy-postgres pg_isready >/dev/null 2>&1; then
        echo -e " - PostgreSQL Database (Port 5433)         : ${GREEN}● ONLINE (Ready)${NC}"
    else
        echo -e " - PostgreSQL Database (Port 5433)         : ${RED}● OFFLINE${NC}"
    fi

    # Worker
    if docker compose ps | grep -q "windy-worker.*Up"; then
        echo -e " - FFmpeg Transcoding Worker               : ${GREEN}● RUNNING (Sẵn sàng xử lý video)${NC}"
    else
        echo -e " - FFmpeg Transcoding Worker               : ${RED}● STOPPED${NC}"
    fi

    # Cloudflare Tunnel
    if docker compose ps | grep -q "windy-tunnel.*Up"; then
        echo -e " - Cloudflare Tunnel Connector             : ${GREEN}● CONNECTED${NC}"
    else
        echo -e " - Cloudflare Tunnel Connector             : ${YELLOW}○ STOPPED / STANDBY${NC}"
    fi
}

# ==============================================================================
# 2. Triển khai lần đầu (Initial Deployment)
# ==============================================================================
initial_deploy() {
    print_header
    echo -e "\n${BOLD}${MAGENTA}🛠️  [2] TRIỂN KHAI LẦN ĐẦU HỆ THỐNG WINDY STORAGE${NC}\n"
    
    echo -e "${YELLOW}LƯU Ý CÁC BƯỚC THỰC HIỆN TRƯỚC KHI BẮT ĐẦU:${NC}"
    echo -e "  1. Kiểm tra file ${BOLD}.env${NC}: Xác nhận mật khẩu DB, Redis, MinIO Access/Secret Key và Cloudflare Token."
    echo -e "  2. Ports sử dụng: Host 80 (Nginx), 5433 (Postgres), 6380 (Redis), 9100/9101 (MinIO), 7701 (Meilisearch)."
    echo -e "  3. Thư mục dữ liệu: Hệ thống sẽ tạo ${BOLD}data/postgres${NC}, ${BOLD}data/redis${NC}, ${BOLD}data/minio${NC}, ${BOLD}data/meilisearch${NC}, ${BOLD}data/nginx_cache${NC}."
    echo -e "  4. Worker: Giới hạn tài nguyên tối đa (4 Core CPU, 4GB RAM) để transcode mượt mà không quá tải host."
    echo ""

    read -p "Bạn có muốn tiếp tục triển khai lần đầu? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        echo -e "${YELLOW}Đã hủy quá trình triển khai.${NC}"
        return
    fi

    # Bước 1: Kiểm tra file .env
    echo -e "\n${CYAN}Bước 1: Kiểm tra tệp .env...${NC}"
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        if [ -f "$PROJECT_DIR/.env.example" ]; then
            echo -e "Tạo .env từ .env.example..."
            cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
            echo -e "${GREEN}✅ Đã tạo .env thành công!${NC}"
        else
            echo -e "${RED}❌ Không tìm thấy .env hoặc .env.example!${NC}"
            return 1
        fi
    else
        echo -e "${GREEN}✅ Tệp .env đã sẵn sàng.${NC}"
    fi

    # Bước 2: Tạo thư mục dữ liệu
    echo -e "\n${CYAN}Bước 2: Khởi tạo cấu trúc thư mục dữ liệu phân vùng data/...${NC}"
    mkdir -p "$PROJECT_DIR/data/postgres"
    mkdir -p "$PROJECT_DIR/data/redis"
    mkdir -p "$PROJECT_DIR/data/minio"
    mkdir -p "$PROJECT_DIR/data/meilisearch"
    mkdir -p "$PROJECT_DIR/data/nginx_cache"
    mkdir -p "$PROJECT_DIR/temp"
    chmod -R 775 "$PROJECT_DIR/data" "$PROJECT_DIR/temp" 2>/dev/null || true
    echo -e "${GREEN}✅ Cây thư mục data/ đã sẵn sàng.${NC}"

    # Bước 3: Đóng gói và khởi động Docker
    echo -e "\n${CYAN}Bước 3: Đóng gói images (API, Worker) và khởi động 8 container...${NC}"
    docker compose up -d --build

    # Bước 4: Kiểm tra kết quả
    echo -e "\n${CYAN}Bước 4: Chờ kiểm tra trạng thái khởi động...${NC}"
    sleep 6
    docker compose ps

    echo -e "\n${GREEN}==============================================================================${NC}"
    echo -e "${BOLD}${GREEN}🎉 TRIỂN KHAI HOÀN TẤT THÀNH CÔNG!${NC}"
    echo -e "${GREEN}==============================================================================${NC}"
    echo -e " - Web Dashboard & Stream : ${CYAN}http://localhost:80/${NC}"
    echo -e " - MinIO S3 Console       : ${CYAN}http://localhost:9101/${NC}"
    echo -e " - Meilisearch Engine     : ${CYAN}http://localhost:7701/${NC}"
    echo -e " - Public Domain          : ${CYAN}${PUBLIC_BASE_URL:-https://video.investinlamdong.vn}${NC}"
    echo -e "\n${YELLOW}📌 LƯU Ý CLOUDFLARE ZERO TRUST:${NC}"
    echo -e "  - Đảm bảo Public Hostname ${BOLD}video.investinlamdong.vn${NC} trỏ vào ${BOLD}http://nginx:80${NC}."
    echo -e "  - Đảm bảo Public Hostname ${BOLD}minio.investinlamdong.vn${NC} trỏ vào ${BOLD}http://minio:9001${NC}."
}

# ==============================================================================
# 3. Cập nhật lại site sau khi cập nhật code
# ==============================================================================
update_code() {
    print_header
    echo -e "\n${BOLD}${YELLOW}🔄 [3] CẬP NHẬT LẠI SITE SAU KHI SỬA CODE${NC}\n"
    echo -e "Chọn thành phần cần cập nhật:"
    echo -e "  1) Cập nhật Backend API (Rebuild NestJS API container)"
    echo -e "  2) Cập nhật Transcoding Worker (Rebuild Worker container với FFmpeg)"
    echo -e "  3) Cập nhật Cả API & Worker (Rebuild cả hai)"
    echo -e "  4) Cập nhật Frontend Web (Chỉ reload Nginx tĩnh, nhanh 1 giây)"
    echo -e "  5) Cập nhật Toàn bộ (Rebuild API, Worker và Restart Nginx)"
    echo -e "  0) Quay lại"
    echo ""
    read -p "Chọn tùy chọn [0-5]: " opt_code

    case $opt_code in
        1)
            echo -e "\n${CYAN}Đang build và khởi động lại API container...${NC}"
            docker compose up -d --build api
            echo -e "${GREEN}✅ API đã được cập nhật thành công!${NC}"
            ;;
        2)
            echo -e "\n${CYAN}Đang build và khởi động lại Worker container...${NC}"
            docker compose up -d --build worker
            echo -e "${GREEN}✅ Worker transcode đã được cập nhật thành công!${NC}"
            ;;
        3)
            echo -e "\n${CYAN}Đang build và cập nhật cả API và Worker...${NC}"
            docker compose up -d --build api worker
            echo -e "${GREEN}✅ API và Worker đã được cập nhật!${NC}"
            ;;
        4)
            echo -e "\n${CYAN}Reload Nginx để cập nhật giao diện Frontend mới...${NC}"
            docker compose restart nginx
            echo -e "${GREEN}✅ Nginx đã reload giao diện tĩnh thành công!${NC}"
            ;;
        5)
            echo -e "\n${CYAN}Đang build lại toàn bộ các dịch vụ ứng dụng...${NC}"
            docker compose up -d --build api worker
            docker compose restart nginx
            echo -e "${GREEN}✅ Hệ thống Windy Storage đã cập nhật toàn diện!${NC}"
            ;;
        0)
            return
            ;;
        *)
            echo -e "${RED}Lựa chọn không hợp lệ!${NC}"
            ;;
    esac
}

# ==============================================================================
# 4. Cập nhật lại site sau khi cập nhật .env
# ==============================================================================
update_env() {
    print_header
    echo -e "\n${BOLD}${GREEN}⚙️  [4] TÁI ÁP DỤNG CẤU HÌNH BIẾN MÔI TRƯỜNG (.ENV)${NC}\n"
    
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        echo -e "${RED}❌ Không tìm thấy tệp .env!${NC}"
        return 1
    fi

    echo -e "Đang đọc các biến cấu hình từ .env..."
    source "$PROJECT_DIR/.env" 2>/dev/null || true
    echo -e " - Cloudflare Token: ${YELLOW}${CLOUDFLARE_TUNNEL_TOKEN:0:15}...${NC}"
    echo -e " - Database Name   : ${YELLOW}${POSTGRES_DB:-windy_video_db}${NC}"
    echo -e " - MinIO S3 Buckets: ${YELLOW}${MINIO_RAW_BUCKET:-raw-videos}, ${MINIO_HLS_BUCKET:-hls-videos}${NC}"
    echo ""

    echo -e "${CYAN}Tái tạo các container chịu ảnh hưởng để nhận biến môi trường mới...${NC}"
    docker compose up -d --force-recreate api worker nginx tunnel
    
    echo -e "\n${CYAN}Kiểm tra kết nối Tunnel sau khi cập nhật:${NC}"
    sleep 3
    docker compose logs tunnel --tail=10 2>/dev/null || true

    echo -e "\n${GREEN}✅ Đã tái áp dụng cấu hình mới từ .env cho toàn bộ hệ thống!${NC}"
}

# ==============================================================================
# 5. Xem logs các bên liên quan
# ==============================================================================
view_logs() {
    print_header
    echo -e "\n${BOLD}${CYAN}📋 [5] XEM NHẬT KÝ HOẠT ĐỘNG (LOGS)${NC}\n"
    echo -e "Chọn dịch vụ muốn xem logs:"
    echo -e "  1) Toàn bộ dịch vụ (All 8 Services - Tail 100 dòng, Realtime)"
    echo -e "  2) NestJS API Server (windy-api)"
    echo -e "  3) FFmpeg Transcoding Worker (windy-worker)"
    echo -e "  4) Nginx Reverse Proxy & HLS Cache (windy-nginx)"
    echo -e "  5) Cloudflare Tunnel Connector (windy-tunnel)"
    echo -e "  6) MinIO Object Storage (windy-minio)"
    echo -e "  7) Redis Message Queue (windy-redis)"
    echo -e "  8) Meilisearch Full-text Engine (windy-meilisearch)"
    echo -e "  9) PostgreSQL Database (windy-postgres)"
    echo -e "  0) Quay lại"
    echo ""
    read -p "Chọn dịch vụ [0-9]: " opt_log

    case $opt_log in
        1)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs...${NC}\n"
            docker compose logs -f --tail=100
            ;;
        2)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs API...${NC}\n"
            docker compose logs -f --tail=100 api
            ;;
        3)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs Worker (FFmpeg)...${NC}\n"
            docker compose logs -f --tail=100 worker
            ;;
        4)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs Nginx...${NC}\n"
            docker compose logs -f --tail=100 nginx
            ;;
        5)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs Tunnel...${NC}\n"
            docker compose logs -f --tail=100 tunnel
            ;;
        6)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs MinIO...${NC}\n"
            docker compose logs -f --tail=100 minio
            ;;
        7)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs Redis...${NC}\n"
            docker compose logs -f --tail=100 redis
            ;;
        8)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs Meilisearch...${NC}\n"
            docker compose logs -f --tail=100 meilisearch
            ;;
        9)
            echo -e "${YELLOW}Nhấn Ctrl+C để thoát khỏi màn hình logs Database...${NC}\n"
            docker compose logs -f --tail=100 postgres
            ;;
        0)
            return
            ;;
        *)
            echo -e "${RED}Lựa chọn không hợp lệ!${NC}"
            ;;
    esac
}

# ==============================================================================
# 6. Tiện ích quản trị nâng cao
# ==============================================================================
extra_utilities() {
    print_header
    echo -e "\n${BOLD}${CYAN}🧰 [6] TIỆN ÍCH QUẢN TRỊ NÂNG CAO${NC}\n"
    echo -e "  1) Khởi động lại toàn bộ dịch vụ (Restart All)"
    echo -e "  2) Tạm dừng toàn bộ dịch vụ (Stop All)"
    echo -e "  3) Sao lưu cơ sở dữ liệu PostgreSQL (Backup Database)"
    echo -e "  4) Xóa bộ nhớ cache Nginx HLS (Clear Nginx Cache)"
    echo -e "  5) Mở Shell vào container NestJS API"
    echo -e "  6) Mở Shell vào container Worker FFmpeg"
    echo -e "  0) Quay lại"
    echo ""
    read -p "Chọn tiện ích [0-6]: " opt_util

    case $opt_util in
        1)
            echo -e "\n${CYAN}Đang khởi động lại toàn bộ 8 containers...${NC}"
            docker compose restart
            echo -e "${GREEN}✅ Toàn bộ dịch vụ đã được khởi động lại!${NC}"
            ;;
        2)
            echo -e "\n${YELLOW}Đang dừng toàn bộ 8 containers...${NC}"
            docker compose down
            echo -e "${GREEN}✅ Đã dừng toàn bộ dịch vụ.${NC}"
            ;;
        3)
            BACKUP_DIR="$PROJECT_DIR/backups"
            mkdir -p "$BACKUP_DIR"
            TIMESTAMP=$(date +%Y%m%d_%H%M%S)
            BACKUP_FILE="$BACKUP_DIR/windy_db_backup_$TIMESTAMP.sql"
            source "$PROJECT_DIR/.env" 2>/dev/null || true
            DB_USER="${POSTGRES_USER:-windy_user}"
            DB_NAME="${POSTGRES_DB:-windy_video_db}"
            
            echo -e "\n${CYAN}Đang sao lưu Database $DB_NAME ra $BACKUP_FILE...${NC}"
            docker exec windy-postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"
            echo -e "${GREEN}✅ Đã sao lưu thành công: $BACKUP_FILE (${BOLD}$(du -h "$BACKUP_FILE" | cut -f1)${NC})${NC}"
            ;;
        4)
            echo -e "\n${CYAN}Đang xóa dữ liệu cache Nginx...${NC}"
            rm -rf "$PROJECT_DIR/data/nginx_cache"/* 2>/dev/null || true
            docker compose restart nginx
            echo -e "${GREEN}✅ Đã dọn sạch bộ nhớ cache HLS video!${NC}"
            ;;
        5)
            echo -e "\n${CYAN}Đang mở terminal vào container windy-api (gõ exit để thoát)...${NC}"
            docker exec -it windy-api sh || true
            ;;
        6)
            echo -e "\n${CYAN}Đang mở terminal vào container windy-worker (gõ exit để thoát)...${NC}"
            docker exec -it windy-worker sh || true
            ;;
        0)
            return
            ;;
        *)
            echo -e "${RED}Lựa chọn không hợp lệ!${NC}"
            ;;
    esac
}

# ==============================================================================
# MENU CHÍNH VÀ ĐIỀU HƯỚNG
# ==============================================================================
main_menu() {
    while true; do
        print_header
        echo -e "${BOLD}CHỌN THAO TÁC CẦN THỰC HIỆN:${NC}"
        echo -e "  ${BOLD}${BLUE}1)${NC} 📊 Dashboard Docker (Trạng thái 8 containers & tài nguyên)"
        echo -e "  ${BOLD}${MAGENTA}2)${NC} 🛠️  Triển khai lần đầu (Lưu ý các bước & Tự động setup)"
        echo -e "  ${BOLD}${YELLOW}3)${NC} 🔄 Cập nhật lại site sau khi CẬP NHẬT CODE (API / Worker / UI)"
        echo -e "  ${BOLD}${GREEN}4)${NC} ⚙️  Cập nhật lại site sau khi CẬP NHẬT .ENV"
        echo -e "  ${BOLD}${CYAN}5)${NC} 📋 Xem Logs các bên liên quan (API, Worker, MinIO, Tunnel...)"
        echo -e "  ${BOLD}${CYAN}6)${NC} 🧰 Tiện ích nâng cao (Restart, Stop, Backup DB, Clear Cache)"
        echo -e "  ${BOLD}0)${NC} ❌ Thoát"
        echo ""
        read -p "Nhập lựa chọn của bạn [0-6]: " choice

        case $choice in
            1) show_dashboard; read -p $'\nBấm Enter để quay lại menu...';;
            2) initial_deploy; read -p $'\nBấm Enter để quay lại menu...';;
            3) update_code; read -p $'\nBấm Enter để quay lại menu...';;
            4) update_env; read -p $'\nBấm Enter để quay lại menu...';;
            5) view_logs; read -p $'\nBấm Enter để quay lại menu...';;
            6) extra_utilities; read -p $'\nBấm Enter để quay lại menu...';;
            0) echo -e "\n${GREEN}Tạm biệt!${NC}\n"; exit 0;;
            *) echo -e "${RED}Lựa chọn không hợp lệ! Vui lòng chọn từ 0 đến 6.${NC}"; sleep 1;;
        esac
    done
}

# Hỗ trợ truyền tham số dòng lệnh trực tiếp (CLI arguments)
case "$1" in
    status|dashboard) show_dashboard ;;
    init|deploy) initial_deploy ;;
    update-code) update_code ;;
    update-env) update_env ;;
    logs)
        shift
        if [ -n "$1" ]; then
            docker compose logs -f --tail=100 "$1"
        else
            docker compose logs -f --tail=100
        fi
        ;;
    restart) docker compose restart ;;
    stop) docker compose down ;;
    *) main_menu ;;
esac
