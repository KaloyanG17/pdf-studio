import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PdfModule } from './pdf/pdf.module';
import { TranslateModule } from './translate/translate.module';
import { FontsModule } from './fonts/fonts.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), FontsModule, PdfModule, TranslateModule],
})
export class AppModule {}
