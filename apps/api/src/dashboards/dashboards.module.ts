import { Module } from '@nestjs/common';
import { SubmissionsModule } from '../submissions/submissions.module';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  imports: [SubmissionsModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
