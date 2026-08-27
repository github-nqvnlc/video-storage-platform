// src/modules/search/search.module.ts
import { Module, Global } from '@nestjs/common';
import { SearchService } from './search.service';

@Global()
@Module({
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
