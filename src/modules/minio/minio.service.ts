// src/modules/minio/minio.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Readable } from 'stream';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private s3Client: S3Client;
  public readonly rawBucket: string;
  public readonly hlsBucket: string;
  public readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.rawBucket = this.configService.get<string>('minio.rawBucket', 'raw-videos');
    this.hlsBucket = this.configService.get<string>('minio.hlsBucket', 'hls-videos');
    this.publicUrl = this.configService.get<string>('minio.publicUrl', 'http://localhost:9000');

    this.s3Client = new S3Client({
      endpoint: this.configService.get<string>('minio.endpoint', 'http://localhost:9000'),
      region: this.configService.get<string>('minio.region', 'us-east-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('minio.accessKey', 'minioadmin'),
        secretAccessKey: this.configService.get<string>('minio.secretKey', 'minio_secure_password_2026'),
      },
      forcePathStyle: true, // MinIO bắt buộc dùng path style
    });
  }

  async onModuleInit() {
    await this.initBuckets();
  }

  /**
   * Khởi tạo buckets, cấp CORS và policy public-read cho hls-videos
   */
  private async initBuckets() {
    try {
      await this.ensureBucket(this.rawBucket, false);
      await this.ensureBucket(this.hlsBucket, true);
      this.logger.log(`MinIO Buckets & CORS initialized: [${this.rawBucket}], [${this.hlsBucket}]`);
    } catch (error) {
      this.logger.warn(`MinIO bucket init check: ${error.message}`);
    }
  }

  private async ensureBucket(bucketName: string, isPublic: boolean) {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch (error) {
      this.logger.log(`Creating bucket: ${bucketName}...`);
      await this.s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
    }

    // Cấu hình CORS cho mọi bucket để trình duyệt upload/stream không bị chặn
    try {
      await this.s3Client.send(
        new PutBucketCorsCommand({
          Bucket: bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedHeaders: ['*'],
                AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                AllowedOrigins: ['*'],
                ExposeHeaders: ['ETag', 'x-amz-request-id', 'Content-Range'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (corsErr) {
      this.logger.warn(`Failed to set CORS on ${bucketName}: ${corsErr.message}`);
    }

    if (isPublic) {
      // Cấp policy public-read cho bucket HLS để client stream được trực tiếp
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      };
      await this.s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(policy),
        }),
      ).catch(() => {});
    }
  }

  /**
   * Tạo Presigned PUT URL để Client upload trực tiếp
   */
  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    expiresIn = 1800,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const rawUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    // Thay thế internal hostname (http://minio:9000) bằng Public URL (https://video-storage.locnv.id.vn/storage)
    try {
      const parsed = new URL(rawUrl);
      const publicBase = new URL(this.publicUrl);

      parsed.protocol = publicBase.protocol;
      parsed.host = publicBase.host;
      parsed.port = publicBase.port;

      if (publicBase.pathname && publicBase.pathname !== '/') {
        const cleanPath = publicBase.pathname.replace(/\/+$/, '');
        parsed.pathname = `${cleanPath}${parsed.pathname}`;
      }

      return parsed.toString();
    } catch (e) {
      return rawUrl;
    }
  }

  /**
   * Tải 1 object từ MinIO về file local
   */
  async downloadToFile(bucket: string, key: string, localFilePath: string): Promise<void> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    const stream = response.Body as Readable;

    await fs.ensureDir(path.dirname(localFilePath));
    const writeStream = fs.createWriteStream(localFilePath);

    return new Promise((resolve, reject) => {
      stream.pipe(writeStream);
      stream.on('error', reject);
      writeStream.on('finish', resolve);
    });
  }

  /**
   * Upload file từ Buffer trực tiếp lên MinIO
   */
  async uploadBuffer(bucket: string, key: string, buffer: Buffer, contentType?: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'video/mp4',
    });
    await this.s3Client.send(command);
  }

  /**
   * Upload 1 file đơn lẻ lên MinIO
   */
  async uploadFile(bucket: string, key: string, filePath: string, contentType?: string): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: contentType || this.guessMimeType(filePath),
    });
    await this.s3Client.send(command);
  }

  /**
   * Upload toàn bộ thư mục (chứa .m3u8 và các file .ts) lên MinIO
   */
  async uploadDirectory(bucket: string, baseKey: string, localDirPath: string): Promise<void> {
    const files = await fs.readdir(localDirPath);

    for (const file of files) {
      const fullPath = path.join(localDirPath, file);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        await this.uploadDirectory(bucket, `${baseKey}/${file}`, fullPath);
      } else {
        const objectKey = `${baseKey}/${file}`;
        await this.uploadFile(bucket, objectKey, fullPath);
      }
    }
  }

  /**
   * Xóa toàn bộ file và thư mục theo tiền tố (Prefix) trên MinIO
   */
  async deleteFolder(bucket: string, prefix: string): Promise<void> {
    try {
      let continuationToken: string | undefined = undefined;

      do {
        const listCommand = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResult = await this.s3Client.send(listCommand);

        if (listResult.Contents && listResult.Contents.length > 0) {
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: listResult.Contents.map((item) => ({ Key: item.Key })),
              Quiet: true,
            },
          });
          await this.s3Client.send(deleteCommand);
        }

        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);

      this.logger.log(`Deleted folder prefix: [${bucket}] ${prefix}`);
    } catch (error) {
      this.logger.error(`Failed to delete folder [${bucket}] ${prefix}:`, error.message);
    }
  }

  /**
   * Xóa một file đơn lẻ
   */
  async deleteFile(bucket: string, key: string): Promise<void> {
    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      this.logger.error(`Failed to delete file [${bucket}] ${key}:`, error.message);
    }
  }

  /**
   * Tạo URL công khai để phát video hoặc xem thumbnail
   */
  getPublicMediaUrl(bucket: string, key: string): string {
    if (!key) return null;
    return `${this.publicUrl}/${bucket}/${key}`;
  }

  private guessMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.m3u8':
        return 'application/vnd.apple.mpegurl';
      case '.ts':
        return 'video/mp2t';
      case '.mp4':
        return 'video/mp4';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.vtt':
        return 'text/vtt';
      default:
        return 'application/octet-stream';
    }
  }
}
