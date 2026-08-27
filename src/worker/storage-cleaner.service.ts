// src/worker/storage-cleaner.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { MinioService } from '../modules/minio/minio.service';
import { CleanStorageJobData } from '../modules/queue/transcode-queue.service';

@Injectable()
export class StorageCleanerService {
  private readonly logger = new Logger(StorageCleanerService.name);

  constructor(private readonly minio: MinioService) {}

  async cleanVideoStorage(data: CleanStorageJobData): Promise<void> {
    this.logger.log(`Cleaning MinIO storage for video: ${data.videoId}`);

    // 1. Xóa file gốc trong raw-videos
    if (data.rawStorageKey) {
      await this.minio.deleteFile(this.minio.rawBucket, data.rawStorageKey);
    }

    // 2. Xóa toàn bộ thư mục HLS (.m3u8, .ts, thumbnails) trong hls-videos
    if (data.hlsPrefix) {
      await this.minio.deleteFolder(this.minio.hlsBucket, data.hlsPrefix);
    }

    this.logger.log(`Cleaned storage successfully for video: ${data.videoId}`);
  }
}
