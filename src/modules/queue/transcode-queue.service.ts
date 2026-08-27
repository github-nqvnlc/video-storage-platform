// src/modules/queue/transcode-queue.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const TRANSCODE_QUEUE = 'video-transcode-queue';

export interface TranscodeJobData {
  videoId: string;
  rawStorageKey: string;
}

export interface CleanStorageJobData {
  videoId: string;
  rawStorageKey?: string;
  hlsPrefix?: string;
}

@Injectable()
export class TranscodeQueueService {
  private readonly logger = new Logger(TranscodeQueueService.name);

  constructor(
    @InjectQueue(TRANSCODE_QUEUE) private readonly transcodeQueue: Queue,
  ) {}

  async addTranscodeJob(data: TranscodeJobData) {
    this.logger.log(`Adding transcode job for video: ${data.videoId}`);
    return await this.transcodeQueue.add('transcode', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async addCleanStorageJob(data: CleanStorageJobData) {
    this.logger.log(`Adding clean storage job for video: ${data.videoId}`);
    return await this.transcodeQueue.add('clean-storage', data, {
      attempts: 2,
      removeOnComplete: true,
    });
  }
}
