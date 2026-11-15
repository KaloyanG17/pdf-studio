import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountModule } from './account/account.module';
import { PdfModule } from './pdf/pdf.module';
import { TranslateModule } from './translate/translate.module';
import { FontsModule } from './fonts/fonts.module';

@Module({
  imports: [
    // backend/.env for local keys; ../.env.local is what `vercel env pull` writes (Supabase, Stripe).
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env.local'] }),
    AccountModule,
    FontsModule,
    PdfModule,
    TranslateModule,
  ],
})
export class AppModule {}
