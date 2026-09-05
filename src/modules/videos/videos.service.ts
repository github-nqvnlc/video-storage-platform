// src/modules/videos/videos.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MinioService } from '../minio/minio.service';
import { SearchService } from '../search/search.service';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { SearchVideoDto } from './dto/search-video.dto';
import {
  InitiateMultipartUploadDto,
  GetPartPresignedUrlDto,
  CompleteMultipartUploadDto,
  AbortMultipartUploadDto,
} from './dto/multipart-upload.dto';
import { VideoStatus, Visibility } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import slugify from 'slugify';
import * as path from 'path';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly searchService: SearchService,
    private readonly queueService: TranscodeQueueService,
  ) {}

  /**
   * [C - Create] Khởi tạo Intent và cấp MinIO Presigned URL
   */
  async createUploadIntent(dto: CreateUploadIntentDto, uploaderId?: string) {
    const videoId = uuidv4();
    const ext = path.extname(dto.originalFilename) || '.mp4';
    const cleanSlug = `${slugify(dto.title, { lower: true, strict: true })}-${videoId.slice(0, 8)}`;
    const rawStorageKey = `${videoId}/raw_${Date.now()}${ext}`;

    // 1. Tạo Presigned PUT URL từ MinIO
    const uploadUrl = await this.minio.getPresignedUploadUrl(
      this.minio.rawBucket,
      rawStorageKey,
      dto.mimeType,
      1800, // 30 phút
    );

    // 2. Tạo bản ghi trạng thái DRAFT trong Postgres
    const video = await this.prisma.video.create({
      data: {
        id: videoId,
        uploaderId: uploaderId || null,
        title: dto.title,
        slug: cleanSlug,
        description: dto.description || null,
        originalFilename: dto.originalFilename,
        rawStorageKey,
        fileSizeBytes: dto.fileSizeBytes ? BigInt(dto.fileSizeBytes) : BigInt(0),
        status: VideoStatus.DRAFT,
        visibility: Visibility.PUBLIC,
      },
    });

    // 3. Xử lý tags nếu có
    if (dto.tags && dto.tags.length > 0) {
      await this.upsertTags(video.id, dto.tags);
    }

    return {
      videoId: video.id,
      uploadUrl,
      rawStorageKey,
      expiresInSeconds: 1800,
    };
  }

  /**
   * [C - Multipart Initiate] Khởi tạo S3 Multipart Upload cho video dung lượng lớn (2GB+)
   */
  async initiateMultipartUpload(dto: InitiateMultipartUploadDto, uploaderId?: string) {
    const videoId = uuidv4();
    const ext = path.extname(dto.originalFilename) || '.mp4';
    const cleanSlug = `${slugify(dto.title, { lower: true, strict: true })}-${videoId.slice(0, 8)}`;
    const rawStorageKey = `${videoId}/raw_${Date.now()}${ext}`;

    // 1. Khởi tạo S3 Multipart Upload trên MinIO
    const uploadId = await this.minio.createMultipartUpload(
      this.minio.rawBucket,
      rawStorageKey,
      dto.mimeType || 'video/mp4',
    );

    // 2. Tạo bản ghi trạng thái DRAFT trong Postgres
    const video = await this.prisma.video.create({
      data: {
        id: videoId,
        uploaderId: uploaderId || null,
        title: dto.title,
        slug: cleanSlug,
        description: dto.description || null,
        originalFilename: dto.originalFilename,
        rawStorageKey,
        fileSizeBytes: dto.fileSizeBytes ? BigInt(dto.fileSizeBytes) : BigInt(0),
        status: VideoStatus.DRAFT,
        visibility: Visibility.PUBLIC,
      },
    });

    // 3. Gắn tags nếu có
    if (dto.tags && dto.tags.length > 0) {
      await this.upsertTags(video.id, dto.tags);
    }

    this.logger.log(`Initiated Multipart Upload: videoId=${videoId}, uploadId=${uploadId}, key=${rawStorageKey}`);

    return {
      videoId: video.id,
      uploadId,
      rawStorageKey,
    };
  }

  /**
   * [C - Multipart Part URL] Cấp Presigned PUT URL cho 1 Part
   */
  async getMultipartPartUrl(id: string, dto: GetPartPresignedUrlDto) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    const presignedUrl = await this.minio.getPresignedPartUploadUrl(
      this.minio.rawBucket,
      video.rawStorageKey,
      dto.uploadId,
      dto.partNumber,
      1800, // 30 phút
    );

    return {
      partNumber: dto.partNumber,
      presignedUrl,
    };
  }

  /**
   * [C - Multipart Complete] Hoàn tất ghép Multipart Upload & kích hoạt Transcode Queue
   */
  async completeMultipartUpload(id: string, dto: CompleteMultipartUploadDto) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    if (video.status !== VideoStatus.DRAFT && video.status !== VideoStatus.FAILED) {
      throw new BadRequestException(`Video đã ở trạng thái ${video.status}`);
    }

    // 1. Gọi MinIO hoàn tất ghép file
    this.logger.log(`Completing S3 Multipart Upload for video: ${id} with ${dto.parts.length} parts...`);
    await this.minio.completeMultipartUpload(
      this.minio.rawBucket,
      video.rawStorageKey,
      dto.uploadId,
      dto.parts,
    );

    // 2. Cập nhật trạng thái sang PROCESSING
    const updated = await this.prisma.video.update({
      where: { id },
      data: {
        status: VideoStatus.PROCESSING,
        fileSizeBytes: dto.fileSizeBytes ? BigInt(dto.fileSizeBytes) : video.fileSizeBytes,
      },
    });

    // 3. Đẩy job vào BullMQ để Transcode Worker thực thi
    await this.queueService.addTranscodeJob({
      videoId: video.id,
      rawStorageKey: video.rawStorageKey,
    });

    this.logger.log(`Multipart upload completed & transcode job queued for video: ${id}`);

    return {
      id: updated.id,
      status: updated.status,
      message: 'Upload hoàn tất thành công. Video đang được đưa vào hàng đợi xử lý HLS.',
    };
  }

  /**
   * [C - Multipart Abort] Hủy bỏ Multipart Upload dở dang và dọn dẹp
   */
  async abortMultipartUpload(id: string, dto: AbortMultipartUploadDto) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      return { success: true, message: 'Video không tồn tại' };
    }

    await this.minio.abortMultipartUpload(
      this.minio.rawBucket,
      video.rawStorageKey,
      dto.uploadId,
    );

    if (video.status === VideoStatus.DRAFT) {
      await this.prisma.video.delete({ where: { id } }).catch(() => {});
    }

    return { success: true, message: 'Đã hủy upload và dọn dẹp tài nguyên' };
  }

  /**
   * [C - Create Direct] Upload file video trực tiếp qua API Server lên MinIO
   */
  async uploadDirect(
    file: any,
    body: { title: string; description?: string; tags?: string[] },
    uploaderId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng cung cấp file video');
    }

    const videoId = uuidv4();
    const ext = path.extname(file.originalname) || '.mp4';
    const cleanSlug = `${slugify(body.title, { lower: true, strict: true })}-${videoId.slice(0, 8)}`;
    const rawStorageKey = `${videoId}/raw_${Date.now()}${ext}`;

    // 1. Upload buffer lên MinIO Bucket raw-videos
    this.logger.log(`Uploading file directly to MinIO: ${rawStorageKey} (${(file.size / (1024*1024)).toFixed(2)} MB)`);
    await this.minio.uploadBuffer(
      this.minio.rawBucket,
      rawStorageKey,
      file.buffer,
      file.mimetype || 'video/mp4',
    );

    // 2. Tạo bản ghi trạng thái PROCESSING
    const video = await this.prisma.video.create({
      data: {
        id: videoId,
        uploaderId: uploaderId || null,
        title: body.title,
        slug: cleanSlug,
        description: body.description || null,
        originalFilename: file.originalname,
        rawStorageKey,
        fileSizeBytes: BigInt(file.size),
        status: VideoStatus.PROCESSING,
        visibility: Visibility.PUBLIC,
      },
    });

    // 3. Xử lý tags
    if (body.tags && body.tags.length > 0) {
      await this.upsertTags(video.id, body.tags);
    }

    // 4. Kích hoạt Transcode Worker qua BullMQ
    await this.queueService.addTranscodeJob({
      videoId: video.id,
      rawStorageKey: video.rawStorageKey,
    });

    return {
      id: video.id,
      title: video.title,
      status: video.status,
      message: 'Video tải lên thành công và đang được đưa vào hàng đợi xử lý HLS!',
    };
  }

  /**
   * [C - Complete] Xác nhận hoàn tất upload & kích hoạt Transcode Queue
   */
  async completeUpload(id: string, dto: CompleteUploadDto) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    if (video.status !== VideoStatus.DRAFT && video.status !== VideoStatus.FAILED) {
      throw new BadRequestException(`Video đã ở trạng thái ${video.status}`);
    }

    // Cập nhật trạng thái sang PROCESSING
    const updated = await this.prisma.video.update({
      where: { id },
      data: {
        status: VideoStatus.PROCESSING,
        fileSizeBytes: dto.actualSizeBytes ? BigInt(dto.actualSizeBytes) : video.fileSizeBytes,
      },
    });

    // Đẩy job vào BullMQ để Transcode Worker thực thi
    await this.queueService.addTranscodeJob({
      videoId: video.id,
      rawStorageKey: video.rawStorageKey,
    });

    return {
      id: updated.id,
      status: updated.status,
      message: 'Upload hoàn tất. Video đang được đưa vào hàng đợi xử lý HLS.',
    };
  }

  /**
   * [Retry] Thử lại transcode cho video bị FAILED hoặc DRAFT
   */
  async retryTranscode(id: string) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    if (!video.rawStorageKey) {
      throw new BadRequestException('Video không có file gốc để xử lý lại');
    }

    // Cập nhật trạng thái về PROCESSING và xóa failureReason
    const updated = await this.prisma.video.update({
      where: { id },
      data: {
        status: VideoStatus.PROCESSING,
        failureReason: null,
      },
    });

    // Đẩy lại job vào BullMQ
    await this.queueService.addTranscodeJob({
      videoId: video.id,
      rawStorageKey: video.rawStorageKey,
    });

    this.logger.log(`Re-queued transcode job for video: ${video.id}`);

    return {
      id: updated.id,
      title: updated.title,
      status: updated.status,
      message: 'Đã gửi lại yêu cầu transcode video thành công!',
    };
  }

  /**
   * [R - Read] Lấy chi tiết 1 video kèm các Public Stream Link
   */
  async findOne(id: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        uploader: { select: { id: true, username: true, email: true } },
      },
    });

    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    return this.transformVideoResponse(video);
  }

  /**
   * [R - Read] Danh sách video phân trang
   */
  async findAll(query: SearchVideoDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.visibility) where.visibility = query.visibility;
    if (query.status) where.status = query.status;

    if (query.tag) {
      where.tags = {
        some: {
          tag: { slug: slugify(query.tag, { lower: true, strict: true }) },
        },
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.video.count({ where }),
      this.prisma.video.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tags: { include: { tag: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: items.map((v) => this.transformVideoResponse(v)),
    };
  }

  /**
   * [S - Search] Tìm kiếm qua Meilisearch
   */
  async search(dto: SearchVideoDto) {
    const filters: string[] = [];
    if (dto.visibility) filters.push(`visibility = "${dto.visibility}"`);
    if (dto.status) filters.push(`status = "${dto.status}"`);
    if (dto.tag) filters.push(`tags = "${dto.tag}"`);

    const result = await this.searchService.searchVideos(dto.q || '', {
      filter: filters.length > 0 ? filters.join(' AND ') : undefined,
      limit: dto.limit || 20,
      offset: ((dto.page || 1) - 1) * (dto.limit || 20),
    });

    const ids = result.hits.map((h: any) => h.id);
    if (ids.length === 0) {
      return {
        total: 0,
        page: dto.page || 1,
        limit: dto.limit || 20,
        items: [],
      };
    }

    const videos = await this.prisma.video.findMany({
      where: { id: { in: ids } },
      include: {
        tags: { include: { tag: true } },
      },
    });

    // Sắp xếp lại theo đúng thứ tự score của Meilisearch
    const sortedVideos = ids
      .map((id) => videos.find((v) => v.id === id))
      .filter(Boolean)
      .map((v) => this.transformVideoResponse(v));

    return {
      total: result.estimatedTotalHits || sortedVideos.length,
      page: dto.page || 1,
      limit: dto.limit || 20,
      items: sortedVideos,
    };
  }

  /**
   * [U - Update] Cập nhật metadata video
   */
  async update(id: string, dto: UpdateVideoDto) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.visibility !== undefined) updateData.visibility = dto.visibility;
    if (dto.thumbnailKey !== undefined) updateData.thumbnailKey = dto.thumbnailKey;

    const updated = await this.prisma.video.update({
      where: { id },
      data: updateData,
      include: { tags: { include: { tag: true } } },
    });

    if (dto.tags) {
      await this.prisma.videoTag.deleteMany({ where: { videoId: id } });
      await this.upsertTags(id, dto.tags);
    }

    // Đồng bộ lại chỉ mục Meilisearch
    await this.searchService.addOrUpdateVideo({
      id: updated.id,
      title: updated.title,
      slug: updated.slug,
      description: updated.description,
      tags: dto.tags || updated.tags.map((t) => t.tag.name),
      durationSeconds: updated.durationSeconds,
      viewCount: Number(updated.viewCount),
      status: updated.status,
      visibility: updated.visibility,
      createdAt: updated.createdAt.getTime(),
    });

    return this.transformVideoResponse(updated);
  }

  /**
   * [D - Delete] Xóa Video & Kích hoạt dọn dẹp sạch Storage
   */
  async remove(id: string) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException(`Video với ID ${id} không tồn tại`);
    }

    // 1. Xóa bản ghi trong Database
    await this.prisma.video.delete({ where: { id } });

    // 2. Xóa khỏi Meilisearch
    await this.searchService.deleteVideo(id);

    // 3. Đẩy job dọn dẹp toàn bộ file MinIO
    await this.queueService.addCleanStorageJob({
      videoId: id,
      rawStorageKey: video.rawStorageKey,
      hlsPrefix: `${id}/`,
    });

    return {
      id,
      message: 'Video đã được xóa thành công và đang được dọn sạch khỏi Object Storage.',
    };
  }

  /**
   * Tăng view count
   */
  async incrementViewCount(id: string) {
    return await this.prisma.video.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
  }

  private async upsertTags(videoId: string, tagNames: string[]) {
    for (const name of tagNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const slug = slugify(trimmed, { lower: true, strict: true });

      const tag = await this.prisma.tag.upsert({
        where: { slug },
        update: { name: trimmed },
        create: { name: trimmed, slug },
      });

      await this.prisma.videoTag.upsert({
        where: { videoId_tagId: { videoId, tagId: tag.id } },
        update: {},
        create: { videoId, tagId: tag.id },
      });
    }
  }

  private transformVideoResponse(video: any) {
    return {
      id: video.id,
      title: video.title,
      slug: video.slug,
      description: video.description,
      originalFilename: video.originalFilename,
      durationSeconds: video.durationSeconds,
      width: video.width,
      height: video.height,
      fileSizeBytes: video.fileSizeBytes ? video.fileSizeBytes.toString() : '0',
      status: video.status,
      visibility: video.visibility,
      viewCount: video.viewCount ? video.viewCount.toString() : '0',
      failureReason: video.failureReason,
      // Public URLs
      hlsMasterUrl: this.minio.getPublicMediaUrl(this.minio.hlsBucket, video.hlsMasterKey),
      thumbnailUrl: this.minio.getPublicMediaUrl(this.minio.hlsBucket, video.thumbnailKey),
      previewSpriteUrl: this.minio.getPublicMediaUrl(this.minio.hlsBucket, video.previewSpriteKey),
      tags: video.tags ? video.tags.map((t: any) => t.tag.name) : [],
      uploader: video.uploader || null,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
    };
  }
}
