import { Module } from '@nestjs/common';
import { EngineCache } from './engine-cache';
import { StructuresController } from './structures.controller';
import { StructuresService } from './structures.service';

@Module({
  controllers: [StructuresController],
  providers: [StructuresService, EngineCache],
  exports: [StructuresService, EngineCache],
})
export class StructuresModule {}
