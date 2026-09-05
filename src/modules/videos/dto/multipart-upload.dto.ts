// src/modules/videos/dto/multipart-upload.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InitiateMultipartUploadDto {
  @ApiProperty({ description: 'Tiêu đề video ban đầu', example: 'Video 4K du lịch' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Tên file gốc bao gồm phần mở rộng', example: 'huge_video.mp4' })
  @IsString()
  @IsNotEmpty()
  originalFilename: string;

  @ApiProperty({ description: 'MIME type của video', example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiPropertyOptional({ description: 'Kích thước file tính theo bytes', example: 2147483648 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fileSizeBytes?: number;

  @ApiPropertyOptional({ description: 'Mô tả video' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Danh sách tags', example: ['4k', 'travel'] })
  @IsOptional()
  tags?: string[];
}

export class GetPartPresignedUrlDto {
  @ApiProperty({ description: 'Upload ID từ S3 Multipart', example: 'xxx-upload-id' })
  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @ApiProperty({ description: 'Số thứ tự của Part (bắt đầu từ 1)', example: 1 })
  @IsNumber()
  @Min(1)
  partNumber: number;
}

export class MultipartPartDto {
  @ApiProperty({ description: 'Số thứ tự Part', example: 1 })
  @IsNumber()
  @Min(1)
  PartNumber: number;

  @ApiProperty({ description: 'ETag trả về từ header response khi upload part', example: '"e59ff97941044f85df5297e1c302d260"' })
  @IsString()
  @IsNotEmpty()
  ETag: string;
}

export class CompleteMultipartUploadDto {
  @ApiProperty({ description: 'Upload ID từ S3 Multipart', example: 'xxx-upload-id' })
  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @ApiProperty({ description: 'Danh sách các Parts đã upload kèm ETag', type: [MultipartPartDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultipartPartDto)
  parts: MultipartPartDto[];

  @ApiPropertyOptional({ description: 'Kích thước file thực tế tính theo bytes', example: 2147483648 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fileSizeBytes?: number;
}

export class AbortMultipartUploadDto {
  @ApiProperty({ description: 'Upload ID từ S3 Multipart', example: 'xxx-upload-id' })
  @IsString()
  @IsNotEmpty()
  uploadId: string;
}
