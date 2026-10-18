import { Module } from '@nestjs/common';
import { StructureAccessController } from '../access/structure-access.controller';
import { StructureAccessService } from '../access/structure-access.service';
import { StructuresModule } from '../structures/structures.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [StructuresModule],
  controllers: [SubmissionsController, StructureAccessController],
  providers: [SubmissionsService, StructureAccessService],
})
export class SubmissionsModule {}
