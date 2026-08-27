import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { SearchVideoDto } from './dto/search-video.dto';

@ApiTags('Videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '[C] Upload video trực tiếp qua API Server lên MinIO' })
  async uploadDirect(
    @UploadedFile() file: any,
    @Body() body: { title: string; description?: string; tags?: string },
  ) {
    const tags = body.tags
      ? (Array.isArray(body.tags) ? body.tags : body.tags.split(',').map((t) => t.trim()).filter(Boolean))
      : [];
    return await this.videosService.uploadDirect(file, {
      title: body.title,
      description: body.description,
      tags,
    });
  }

  @Post('upload-intent')
  @ApiOperation({ summary: '[C] Khởi tạo upload & nhận Presigned URL từ MinIO' })
  @ApiResponse({ status: 201, description: 'Cấp Presigned URL thành công' })
  async createUploadIntent(@Body() dto: CreateUploadIntentDto) {
    return await this.videosService.createUploadIntent(dto);
  }

  @Post(':id/complete-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[C] Báo hoàn tất upload để kích hoạt hàng đợi transcode HLS' })
  async completeUpload(
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return await this.videosService.completeUpload(id, dto);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Retry] Thử lại xử lý transcode video bị lỗi hoặc treo' })
  async retryTranscode(@Param('id') id: string) {
    return await this.videosService.retryTranscode(id);
  }

  @Get('search')
  @ApiOperation({ summary: '[S] Tìm kiếm video tức thì qua Meilisearch' })
  async search(@Query() query: SearchVideoDto) {
    return await this.videosService.search(query);
  }

  @Get()
  @ApiOperation({ summary: '[R] Danh sách video có phân trang và bộ lọc' })
  async findAll(@Query() query: SearchVideoDto) {
    return await this.videosService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '[R] Lấy chi tiết video & link streaming HLS' })
  async findOne(@Param('id') id: string) {
    return await this.videosService.findOne(id);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tăng lượt xem video' })
  async incrementView(@Param('id') id: string) {
    await this.videosService.incrementViewCount(id);
    return { success: true };
  }

  @Patch(':id')
  @ApiOperation({ summary: '[U] Cập nhật metadata video (tiêu đề, tags, visibility)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVideoDto,
  ) {
    return await this.videosService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '[D] Xóa video trong DB và dọn sạch file trên MinIO' })
  async remove(@Param('id') id: string) {
    return await this.videosService.remove(id);
  }
}
