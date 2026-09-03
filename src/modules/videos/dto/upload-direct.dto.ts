import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadDirectDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'File video (MP4, MOV, MKV, AVI...)' })
  file: any;

  @ApiProperty({ description: 'Tiêu đề video', example: 'Video giới thiệu sản phẩm' })
  @IsNotEmpty({ message: 'Tiêu đề không được để trống' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Mô tả chi tiết video', example: 'Mô tả nội dung video' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Danh sách tags (cách nhau bởi dấu phẩy)', example: 'demo,4k,intro' })
  @IsOptional()
  @IsString()
  tags?: string;
}
