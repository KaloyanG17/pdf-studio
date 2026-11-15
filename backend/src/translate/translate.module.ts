import { Body, Controller, Get, Module, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../account/supabase.service';
import { TranslateService } from './translate.service';

interface TranslateBody {
  texts: string[];
  source: string; // 'auto' | language code
  target: string;
  provider?: string;
}

@Controller('translate')
export class TranslateController {
  constructor(
    private readonly svc: TranslateService,
    private readonly accounts: SupabaseService,
  ) {}

  @Get()
  info() {
    return this.svc.info();
  }

  @Post()
  async translate(@Req() req: Request, @Body() body: TranslateBody) {
    this.svc.validate(body.texts, body.source ?? 'auto', body.target);
    // Each plan has a character quota (guests per day, accounts per month).
    await this.accounts.consumeTranslation(req, body.texts.reduce((n, t) => n + t.length, 0));
    return this.svc.translate(body.texts, body.source ?? 'auto', body.target, body.provider);
  }
}

@Module({ controllers: [TranslateController], providers: [TranslateService] })
export class TranslateModule {}
