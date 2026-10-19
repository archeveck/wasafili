import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { HttpMetrics } from './metrics';

@Module({
  imports: [FilesModule],
  controllers: [HealthController, MetricsController],
  providers: [HttpMetrics],
  exports: [HttpMetrics],
})
export class HealthModule {}
