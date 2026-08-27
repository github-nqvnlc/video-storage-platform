export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    publicUrl: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minio_secure_password_2026',
    rawBucket: process.env.MINIO_RAW_BUCKET || 'raw-videos',
    hlsBucket: process.env.MINIO_HLS_BUCKET || 'hls-videos',
    region: process.env.MINIO_REGION || 'us-east-1',
  },
  meilisearch: {
    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILISEARCH_API_KEY || 'meili_master_key_123456',
  },
  worker: {
    concurrency: parseInt(process.env.TRANSCODE_CONCURRENCY, 10) || 2,
    tempDir: process.env.TEMP_STORAGE_DIR || '/tmp/windy-transcode',
  },
});
