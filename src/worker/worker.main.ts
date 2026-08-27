// src/worker/worker.main.ts
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  
  logger.log('====================================================');
  logger.log('  WINDY STORAGE - TRANSCODING WORKER IS RUNNING     ');
  logger.log('  Listening for video-transcode BullMQ jobs...      ');
  logger.log('====================================================');

  process.on('SIGTERM', async () => {
    logger.log('Worker SIGTERM received. Closing gracefully...');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
