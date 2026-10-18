import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { StructuresModule } from '../structures/structures.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { GotenbergClient } from './gotenberg';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [StructuresModule, SubmissionsModule, FilesModule],
  controllers: [ReportsController],
  providers: [ReportsService, GotenbergClient],
  exports: [ReportsService],
})
export class ReportsModule {}
