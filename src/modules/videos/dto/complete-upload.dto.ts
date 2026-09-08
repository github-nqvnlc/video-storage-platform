// src/modules/videos/dto/complete-upload.dto.ts
import { IsOptional, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteUploadDto {
  @ApiPropertyOptional({
    description: 'Kích thước thực tế sau khi upload thành công',
  })
  @IsOptional()
  @IsNumber()
  actualSizeBytes?: number;
}
