// src/modules/videos/dto/create-upload-intent.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUploadIntentDto {
  @ApiProperty({ description: 'Tiêu đề video ban đầu', example: 'Khám phá Đà Lạt 4K' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Tên file gốc bao gồm phần mở rộng', example: 'dalat_travel.mp4' })
  @IsString()
  @IsNotEmpty()
  originalFilename: string;

  @ApiProperty({ description: 'MIME type của video', example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiPropertyOptional({ description: 'Kích thước file tính theo bytes', example: 104857600 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fileSizeBytes?: number;

  @ApiPropertyOptional({ description: 'Mô tả video' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Danh sách tags', example: ['dulich', 'dalat', '4k'] })
  @IsOptional()
  tags?: string[];
}
