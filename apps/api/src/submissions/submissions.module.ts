import { Module } from '@nestjs/common';
import { StructureAccessController } from '../access/structure-access.controller';
import { StructureAccessService } from '../access/structure-access.service';
import { GotenbergClient } from '../reports/gotenberg';
import { StructuresModule } from '../structures/structures.module';
import { TasksModule } from '../tasks/tasks.module';
import { SyncController } from '../sync/sync.controller';
import { SyncService } from '../sync/sync.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [StructuresModule, TasksModule],
  controllers: [SubmissionsController, StructureAccessController, SyncController],
  // Gotenberg : export PDF des fiches ici, rapports dans ReportsModule (qui importe ce module).
  providers: [SubmissionsService, StructureAccessService, SyncService, GotenbergClient],
  exports: [SubmissionsService, GotenbergClient],
})
export class SubmissionsModule {}
