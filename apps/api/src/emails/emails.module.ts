import { Global, Module } from '@nestjs/common';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';

@Global()
@Module({ controllers: [EmailsController], providers: [EmailsService], exports: [EmailsService] })
export class EmailsModule {}
