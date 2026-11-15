import { BadRequestException, Body, Controller, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PdfService } from './pdf.service';
import type { ExportSpec } from './types';

const MB = 1024 * 1024;

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdf: PdfService) {}

  /**
   * multipart/form-data:
   *   files - the source PDFs (in the order referenced by pages[].source.file)
   *   fonts - fonts taken from the source PDFs; each file's name is its fontRef
   *   spec  - JSON ExportSpec
   */
  @Post('export')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: 50 },
        { name: 'fonts', maxCount: 500 },
      ],
      { limits: { fileSize: 200 * MB, fieldSize: 200 * MB } },
    ),
  )
  async export(
    @UploadedFiles() uploads: { files?: Express.Multer.File[]; fonts?: Express.Multer.File[] } | undefined,
    @Body('spec') specJson: string,
    @Res() res: Response,
  ) {
    let spec: ExportSpec;
    try {
      spec = JSON.parse(specJson);
    } catch {
      throw new BadRequestException('Invalid spec JSON');
    }
    const fonts = new Map((uploads?.fonts ?? []).map((f) => [f.originalname, f.buffer] as const));
    const bytes = await this.pdf.export(
      spec,
      (uploads?.files ?? []).map((f) => f.buffer),
      fonts,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
    res.send(Buffer.from(bytes));
  }
}
