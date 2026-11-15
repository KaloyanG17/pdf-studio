import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { TranslateService } from './translate.service';

interface TranslateBody {
  texts: string[];
  source: string; // 'auto' | language code
  target: string;
  provider?: string;
}

@Controller('translate')
export class TranslateController {
  constructor(private readonly svc: TranslateService) {}

  @Get()
  info() {
    return this.svc.info();
  }

  @Post()
  translate(@Body() body: TranslateBody) {
    return this.svc.translate(body.texts, body.source ?? 'auto', body.target, body.provider);
  }
}

@Module({ controllers: [TranslateController], providers: [TranslateService] })
export class TranslateModule {}
