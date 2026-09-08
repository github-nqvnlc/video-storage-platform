// src/worker/transcode.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MinioService } from '../modules/minio/minio.service';
import { SearchService } from '../modules/search/search.service';
import { FFmpegService } from './ffmpeg.service';
import { StorageCleanerService } from './storage-cleaner.service';
import {
  TRANSCODE_QUEUE,
  TranscodeJobData,
  CleanStorageJobData,
} from '../modules/queue/transcode-queue.service';
import { VideoStatus } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs-extra';

@Processor(TRANSCODE_QUEUE, {
  concurrency: parseInt(process.env.TRANSCODE_CONCURRENCY, 10) || 2,
})
export class TranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly searchService: SearchService,
    private readonly ffmpeg: FFmpegService,
    private readonly cleaner: StorageCleanerService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'transcode':
        return await this.handleTranscodeJob(job as Job<TranscodeJobData>);
      case 'clean-storage':
        return await this.cleaner.cleanVideoStorage(
          job.data as CleanStorageJobData,
        );
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleTranscodeJob(job: Job<TranscodeJobData>) {
    const { videoId, rawStorageKey } = job.data;
    this.logger.log(`Processing transcode job for video: ${videoId}`);

    const baseTempDir = process.env.TEMP_STORAGE_DIR || '/tmp/windy-transcode';
    const workDir = path.join(baseTempDir, videoId);
    const rawLocalPath = path.join(
      workDir,
      'raw_video' + path.extname(rawStorageKey),
    );
    const hlsLocalDir = path.join(workDir, 'hls');

    await fs.ensureDir(workDir);
    await fs.ensureDir(hlsLocalDir);

    try {
      // 1. Tải video gốc từ MinIO về máy
      this.logger.log(
        `[1/5] Downloading raw video from MinIO: ${rawStorageKey}`,
      );
      await this.minio.downloadToFile(
        this.minio.rawBucket,
        rawStorageKey,
        rawLocalPath,
      );

      // 2. Bóc tách thông số kỹ thuật (ffprobe)
      this.logger.log(`[2/5] Probing video metadata...`);
      const meta = await this.ffmpeg.probe(rawLocalPath);

      // 3. Transcode sang HLS ABR (Multi-bitrate)
      this.logger.log(`[3/5] Transcoding to HLS ABR...`);
      await this.ffmpeg.transcodeToHls(rawLocalPath, hlsLocalDir, meta);

      // 4. Trích xuất Thumbnail & Storyboard Sprite
      this.logger.log(`[4/5] Extracting thumbnail & storyboard...`);
      const thumbTimestamp = Math.min(
        5,
        Math.floor(meta.durationSeconds * 0.2),
      );
      const thumbLocalPath = path.join(hlsLocalDir, 'thumbnail.jpg');
      await this.ffmpeg.generateThumbnail(
        rawLocalPath,
        thumbLocalPath,
        thumbTimestamp,
      );

      const spriteResult = await this.ffmpeg.generateSpritePreview(
        rawLocalPath,
        hlsLocalDir,
        meta.durationSeconds,
      );

      // 5. Upload toàn bộ output HLS lên MinIO bucket `hls-videos`
      this.logger.log(
        `[5/5] Uploading HLS chunks & assets to MinIO: ${videoId}/...`,
      );
      const hlsMinioPrefix = `${videoId}`;
      await this.minio.uploadDirectory(
        this.minio.hlsBucket,
        hlsMinioPrefix,
        hlsLocalDir,
      );

      const hlsMasterKey = `${videoId}/master.m3u8`;
      const thumbnailKey = `${videoId}/thumbnail.jpg`;
      const previewSpriteKey = spriteResult
        ? `${videoId}/storyboard.vtt`
        : null;

      // 6. Cập nhật trạng thái video sang READY trong Postgres
      const updatedVideo = await this.prisma.video.update({
        where: { id: videoId },
        data: {
          status: VideoStatus.READY,
          durationSeconds: meta.durationSeconds,
          width: meta.width,
          height: meta.height,
          hlsMasterKey,
          thumbnailKey,
          previewSpriteKey,
          failureReason: null,
        },
        include: { tags: { include: { tag: true } } },
      });

      // 7. Đồng bộ sang Meilisearch
      await this.searchService.addOrUpdateVideo({
        id: updatedVideo.id,
        title: updatedVideo.title,
        slug: updatedVideo.slug,
        description: updatedVideo.description,
        tags: updatedVideo.tags.map((t) => t.tag.name),
        durationSeconds: updatedVideo.durationSeconds,
        viewCount: Number(updatedVideo.viewCount),
        status: updatedVideo.status,
        visibility: updatedVideo.visibility,
        createdAt: updatedVideo.createdAt.getTime(),
      });

      this.logger.log(
        `Transcode job completed successfully for video: ${videoId}`,
      );
      return { success: true, videoId };
    } catch (error) {
      const cleanReason = this.extractCleanErrorMessage(error);
      this.logger.error(
        `Transcode failed for video ${videoId}: ${cleanReason}`,
      );

      await this.prisma.video
        .update({
          where: { id: videoId },
          data: {
            status: VideoStatus.FAILED,
            failureReason: cleanReason,
          },
        })
        .catch((dbErr) =>
          this.logger.error('DB update failed on error state:', dbErr),
        );

      throw error;
    } finally {
      // Dọn dẹp thư mục tạm trên ổ cứng
      await fs.remove(workDir).catch(() => {});
    }
  }

  /**
   * Rút gọn thông báo lỗi FFmpeg thành lý do ngắn gọn, dễ hiểu
   */
  private extractCleanErrorMessage(error: any): string {
    const raw = (error?.stderr || error?.message || String(error)).trim();

    if (
      raw.includes('matches no streams') ||
      raw.includes("Failed to set value 'a:0'")
    ) {
      return 'File video không có track âm thanh hoặc định dạng stream không hợp lệ';
    }
    if (raw.includes('Invalid data found when processing input')) {
      return 'File video bị hỏng (corrupt) hoặc không đúng định dạng chuẩn';
    }
    if (raw.includes('No space left on device')) {
      return 'Dung lượng ổ cứng tạm thời của máy chủ đã đầy';
    }
    if (raw.includes('Connection refused') || raw.includes('ECONNREFUSED')) {
      return 'Mất kết nối tới máy chủ lưu trữ MinIO';
    }

    // Lấy 1 dòng lỗi ngắn gọn nhất
    const lines = raw
      .split('\n')
      .map((l: string) => l.trim())
      .filter(
        (l: string) =>
          l.length > 0 &&
          !l.startsWith('ffmpeg version') &&
          !l.startsWith('configuration:'),
      );
    const errorLine = lines.find(
      (l: string) =>
        l.toLowerCase().includes('error') || l.toLowerCase().includes('failed'),
    );
    if (errorLine) {
      return errorLine.slice(0, 160);
    }

    return raw.slice(0, 160);
  }
}
