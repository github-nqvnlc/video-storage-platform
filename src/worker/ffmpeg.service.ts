// src/worker/ffmpeg.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs-extra';
import execa from 'execa';

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  bitrate: number;
  hasAudio: boolean;
}

@Injectable()
export class FFmpegService {
  private readonly logger = new Logger(FFmpegService.name);

  /**
   * Trích xuất thông tin kỹ thuật của video bằng ffprobe
   */
  async probe(inputPath: string): Promise<VideoMetadata> {
    try {
      const { stdout } = await execa('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputPath,
      ]);

      const data = JSON.parse(stdout);
      const videoStream = data.streams?.find(
        (s: any) => s.codec_type === 'video',
      );
      const audioStream = data.streams?.find(
        (s: any) => s.codec_type === 'audio',
      );

      const duration = Math.round(
        parseFloat(data.format?.duration || videoStream?.duration || '0'),
      );
      const width = parseInt(videoStream?.width || '0', 10);
      const height = parseInt(videoStream?.height || '0', 10);
      const bitrate = parseInt(data.format?.bit_rate || '0', 10);
      const hasAudio = !!audioStream;

      return {
        durationSeconds: duration,
        width,
        height,
        bitrate,
        hasAudio,
      };
    } catch (error) {
      this.logger.error(`ffprobe error on ${inputPath}:`, error.message);
      throw new Error(`Không thể phân tích video: ${error.message}`);
    }
  }

  /**
   * Transcode video sang chuẩn HLS Adaptive Bitrate (ABR) (Hỗ trợ cả video có tiếng và không có tiếng)
   */
  async transcodeToHls(
    inputPath: string,
    outputDir: string,
    meta: VideoMetadata,
  ): Promise<string> {
    await fs.ensureDir(outputDir);

    // Xác định các profile độ phân giải phù hợp với video gốc
    const profiles: Array<{
      name: string;
      width: number;
      height: number;
      videoBitrate: string;
      maxrate: string;
      bufsize: string;
      audioBitrate: string;
    }> = [];

    if (meta.height >= 1080) {
      profiles.push({
        name: '1080p',
        width: 1920,
        height: 1080,
        videoBitrate: '4500k',
        maxrate: '4800k',
        bufsize: '9000k',
        audioBitrate: '128k',
      });
    }
    if (meta.height >= 720) {
      profiles.push({
        name: '720p',
        width: 1280,
        height: 720,
        videoBitrate: '2500k',
        maxrate: '2700k',
        bufsize: '5000k',
        audioBitrate: '128k',
      });
    }
    if (meta.height >= 480 || profiles.length === 0) {
      profiles.push({
        name: '480p',
        width: 854,
        height: 480,
        videoBitrate: '1000k',
        maxrate: '1100k',
        bufsize: '2000k',
        audioBitrate: '96k',
      });
    }
    if (meta.height < 480) {
      profiles.push({
        name: '360p',
        width: 640,
        height: 360,
        videoBitrate: '600k',
        maxrate: '650k',
        bufsize: '1200k',
        audioBitrate: '64k',
      });
    }

    const filterComplex: string[] = [];
    const mapArgs: string[] = [];
    const varStreamMap: string[] = [];

    // Xây dựng chuỗi filter_complex cho multi-bitrate
    const splitCount = profiles.length;
    let splitOutputs = '';
    for (let i = 0; i < splitCount; i++) {
      splitOutputs += `[v${i}]`;
    }
    filterComplex.push(`[0:v]split=${splitCount}${splitOutputs}`);

    profiles.forEach((p, index) => {
      filterComplex.push(
        `[v${index}]scale=w=${p.width}:h=${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2[v${index}out]`,
      );

      mapArgs.push(
        '-map',
        `[v${index}out]`,
        `-c:v:${index}`,
        'libx264',
        `-b:v:${index}`,
        p.videoBitrate,
        `-maxrate:v:${index}`,
        p.maxrate,
        `-bufsize:v:${index}`,
        p.bufsize,
        `-preset`,
        'fast',
        `-g`,
        '48',
        `-sc_threshold`,
        '0',
      );

      if (meta.hasAudio) {
        mapArgs.push(
          '-map',
          '0:a:0?',
          `-c:a:${index}`,
          'aac',
          `-b:a:${index}`,
          p.audioBitrate,
          `-ac`,
          '2',
        );
        varStreamMap.push(`v:${index},a:${index},name:${p.name}`);
      } else {
        varStreamMap.push(`v:${index},name:${p.name}`);
      }
    });

    const masterPlaylist = 'master.m3u8';
    const ffmpegArgs = [
      '-i',
      inputPath,
      '-filter_complex',
      filterComplex.join('; '),
      ...mapArgs,
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_playlist_type',
      'vod',
      '-hls_flags',
      'independent_segments',
      '-hls_segment_type',
      'mpegts',
      '-hls_segment_filename',
      path.join(outputDir, '%v', 'segment_%03d.ts'),
      '-master_pl_name',
      masterPlaylist,
      '-var_stream_map',
      varStreamMap.join(' '),
      path.join(outputDir, '%v', 'playlist.m3u8'),
    ];

    this.logger.log(
      `Starting FFmpeg HLS transcode (hasAudio: ${meta.hasAudio}) with ${profiles.length} profiles: [${profiles.map((p) => p.name).join(', ')}]`,
    );

    // Tạo sẵn các thư mục con cho từng profile
    for (const p of profiles) {
      await fs.ensureDir(path.join(outputDir, p.name));
    }

    await execa('ffmpeg', ffmpegArgs);
    this.logger.log(
      `HLS transcode finished: ${path.join(outputDir, masterPlaylist)}`,
    );

    return masterPlaylist;
  }

  /**
   * Tạo Thumbnail chính từ khung hình ở giây thứ 5 (hoặc 20% thời lượng)
   */
  async generateThumbnail(
    inputPath: string,
    outputPath: string,
    timestampSeconds = 5,
  ): Promise<string> {
    await fs.ensureDir(path.dirname(outputPath));

    await execa('ffmpeg', [
      '-ss',
      timestampSeconds.toString(),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease',
      '-y',
      outputPath,
    ]);

    return outputPath;
  }

  /**
   * Tạo Sprite Sheet Preview (Storyboard) + WebVTT cho player
   */
  async generateSpritePreview(
    inputPath: string,
    outputDir: string,
    durationSeconds: number,
  ): Promise<{ spritePath: string; vttPath: string } | null> {
    try {
      await fs.ensureDir(outputDir);
      const spritePath = path.join(outputDir, 'storyboard.jpg');
      const vttPath = path.join(outputDir, 'storyboard.vtt');

      const interval = Math.max(2, Math.floor(durationSeconds / 50)); // ~50 frames

      // Tạo ảnh sprite dạng grid
      await execa('ffmpeg', [
        '-i',
        inputPath,
        '-vf',
        `fps=1/${interval},scale=160:90,tile=10x5`,
        '-q:v',
        '3',
        '-y',
        spritePath,
      ]);

      // Sinh file WebVTT
      let vttContent = 'WEBVTT\n\n';
      const frameCount = Math.min(50, Math.floor(durationSeconds / interval));
      const width = 160;
      const height = 90;
      const cols = 10;

      for (let i = 0; i < frameCount; i++) {
        const startSec = i * interval;
        const endSec = Math.min((i + 1) * interval, durationSeconds);
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * width;
        const y = row * height;

        vttContent += `${this.formatVttTime(startSec)} --> ${this.formatVttTime(endSec)}\n`;
        vttContent += `storyboard.jpg#xywh=${x},${y},${width},${height}\n\n`;
      }

      await fs.writeFile(vttPath, vttContent, 'utf-8');
      return { spritePath, vttPath };
    } catch (err) {
      this.logger.warn(`Failed to generate sprite preview: ${err.message}`);
      return null;
    }
  }

  private formatVttTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.000`;
  }
}
