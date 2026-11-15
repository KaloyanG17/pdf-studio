import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FontsService } from './fonts.service';

@Controller('fonts')
export class FontsController {
  constructor(private readonly fonts: FontsService) {}

  @Get(':key')
  get(@Param('key') key: string, @Res() res: Response) {
    const buf = this.fonts.get(key.replace(/\.ttf$/, ''));
    res.setHeader('Content-Type', 'font/ttf');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  }
}
