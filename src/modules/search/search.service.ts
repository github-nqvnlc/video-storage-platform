// src/modules/search/search.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch, Index } from 'meilisearch';

export interface VideoSearchDocument {
  id: string;
  title: string;
  slug: string;
  description?: string;
  tags?: string[];
  durationSeconds: number;
  viewCount: number;
  status: string;
  visibility: string;
  createdAt: number; // Timestamp
}

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: MeiliSearch;
  private videoIndex: Index<VideoSearchDocument>;

  constructor(private readonly configService: ConfigService) {
    this.client = new MeiliSearch({
      host: this.configService.get<string>(
        'meilisearch.host',
        'http://localhost:7700',
      ),
      apiKey: this.configService.get<string>(
        'meilisearch.apiKey',
        'meili_master_key_123456',
      ),
    });
  }

  async onModuleInit() {
    await this.initIndex();
  }

  private async initIndex() {
    try {
      this.videoIndex = this.client.index('videos');

      // Cấu hình các trường tìm kiếm, bộ lọc và sắp xếp
      await this.videoIndex.updateSettings({
        searchableAttributes: ['title', 'description', 'tags'],
        filterableAttributes: [
          'status',
          'visibility',
          'tags',
          'durationSeconds',
        ],
        sortableAttributes: ['createdAt', 'viewCount', 'durationSeconds'],
        rankingRules: [
          'words',
          'typo',
          'proximity',
          'attribute',
          'sort',
          'exactness',
        ],
      });
      this.logger.log('Meilisearch "videos" index configured successfully.');
    } catch (error) {
      this.logger.warn(`Meilisearch connection/init warning: ${error.message}`);
    }
  }

  async addOrUpdateVideo(doc: VideoSearchDocument): Promise<void> {
    try {
      if (!this.videoIndex) return;
      await this.videoIndex.addDocuments([doc], { primaryKey: 'id' });
    } catch (error) {
      this.logger.error(
        `Failed to index video ${doc.id} in Meilisearch:`,
        error.message,
      );
    }
  }

  async deleteVideo(videoId: string): Promise<void> {
    try {
      if (!this.videoIndex) return;
      await this.videoIndex.deleteDocument(videoId);
    } catch (error) {
      this.logger.error(
        `Failed to delete video ${videoId} from Meilisearch:`,
        error.message,
      );
    }
  }

  async searchVideos(
    query: string,
    options?: {
      filter?: string | string[];
      sort?: string[];
      limit?: number;
      offset?: number;
    },
  ) {
    try {
      if (!this.videoIndex) {
        return { hits: [], estimatedTotalHits: 0 };
      }
      return await this.videoIndex.search(query || '', {
        filter: options?.filter,
        sort: options?.sort,
        limit: options?.limit || 20,
        offset: options?.offset || 0,
      });
    } catch (error) {
      this.logger.error(`Search query failed for "${query}":`, error.message);
      return { hits: [], estimatedTotalHits: 0 };
    }
  }
}
