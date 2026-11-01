import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type {
  MetricExporter,
  ExportInput,
  ExportFile,
} from './metric-exporter.contract';
import { baseFilename } from './metric-exporter.contract';

@Injectable()
export class PdfExporter implements MetricExporter {
  readonly format = 'pdf' as const;

  async render(input: ExportInput): Promise<ExportFile> {
    const { result } = input;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]); // A4
    let y = 800;
    const line = (text: string, size = 11, f = font) => {
      page.drawText(text, { x: 40, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size + 6;
    };
    line(`${input.title} (${input.metric})`, 18, bold);
    line(
      `${input.query.from} -> ${input.query.to} · grain ${input.query.grain}`,
      10,
    );
    y -= 8;
    line(`Total: ${result.total} ${result.unit}`, 14, bold);
    if (result.delta)
      line(`Delta vs baseline: ${(result.delta.pct * 100).toFixed(1)}%`, 10);
    y -= 8;
    line('Series', 12, bold);
    for (const s of result.series.slice(0, 40))
      line(`${s.bucket}    ${s.value}`, 10);
    y = 40;
    line(
      `computed ${result.meta.computedAt}${result.meta.stale ? ' · STALE' : ''}`,
      8,
    );
    const buffer = Buffer.from(await doc.save());
    return {
      buffer,
      contentType: 'application/pdf',
      filename: baseFilename(input, 'pdf'),
    };
  }
}
