import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsController } from './groups.controller';
import { IamService } from './iam.service';
import { MeController } from './me.controller';
import { RolesController } from './roles.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  controllers: [MeController, UsersController, RolesController, GroupsController],
  providers: [IamService],
})
export class IamModule {}
