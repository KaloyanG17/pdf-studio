import { Global, Module } from '@nestjs/common';
import { FontsController } from './fonts.controller';
import { FontsService } from './fonts.service';

@Global()
@Module({ controllers: [FontsController], providers: [FontsService], exports: [FontsService] })
export class FontsModule {}
