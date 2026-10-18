import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { TasksModule } from '../tasks/tasks.module';
import { AutomationRunner } from './automation-runner';
import { AutomationsController } from './automations.controller';
import { AutomationsProcessor } from './automations.processor';
import { AutomationsService } from './automations.service';

@Module({
  imports: [SubmissionsModule, TasksModule, ReportsModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationRunner, AutomationsProcessor],
})
export class AutomationsModule {}
