// src/modules/videos/dto/search-video.dto.ts
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Visibility, VideoStatus } from '@prisma/client';

export class SearchVideoDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm (tiêu đề, mô tả, tags)',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Lọc theo tag cụ thể' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ enum: Visibility, description: 'Lọc theo quyền xem' })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({
    enum: VideoStatus,
    description: 'Lọc theo trạng thái xử lý',
  })
  @IsOptional()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @ApiPropertyOptional({
    description: 'Sắp xếp: createdAt:desc, viewCount:desc, durationSeconds:asc',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
