import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { MeController } from './me.controller';
import { RolesController } from './roles.controller';
import { UsersController } from './users.controller';

@Module({ controllers: [MeController, UsersController, RolesController, GroupsController] })
export class IamModule {}
