// src/worker/worker.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { DatabaseModule } from '../database/database.module';
import { MinioModule } from '../modules/minio/minio.module';
import { SearchModule } from '../modules/search/search.module';
import { QueueModule } from '../modules/queue/queue.module';
import { FFmpegService } from './ffmpeg.service';
import { StorageCleanerService } from './storage-cleaner.service';
import { TranscodeProcessor } from './transcode.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    MinioModule,
    SearchModule,
    QueueModule,
  ],
  providers: [
    FFmpegService,
    StorageCleanerService,
    TranscodeProcessor,
  ],
})
export class WorkerModule {}
