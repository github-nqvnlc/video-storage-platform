// src/modules/videos/dto/update-video.dto.ts
import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Visibility } from '@prisma/client';

export class UpdateVideoDto {
  @ApiPropertyOptional({ description: 'Cập nhật tiêu đề video' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Cập nhật mô tả video' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: Visibility,
    description: 'Chế độ hiển thị: PUBLIC, UNLISTED, PRIVATE',
  })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({
    description: 'Danh sách tags cập nhật',
    example: ['dulich', 'vietnam'],
  })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: 'Custom thumbnail storage key' })
  @IsOptional()
  @IsString()
  thumbnailKey?: string;
}
