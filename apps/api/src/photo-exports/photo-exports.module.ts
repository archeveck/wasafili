import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { StructuresModule } from '../structures/structures.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { PhotoExportsController } from './photo-exports.controller';
import { PhotoExportsService } from './photo-exports.service';

@Module({
  imports: [SubmissionsModule, StructuresModule, FilesModule],
  controllers: [PhotoExportsController],
  providers: [PhotoExportsService],
})
export class PhotoExportsModule {}
