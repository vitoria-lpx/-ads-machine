import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore -- pdfkit não tem export default tipado corretamente com esModuleInterop
import PDFDocument from 'pdfkit';

import { compareBrand, BrandConfig, BrandComparisonResult } from './lib/report';

const PAGE_IDS_PATH = path.resolve(process.cwd(), 'reference', 'marcas-lpx-ads.json');
const OUTPUT_DIR = path.resolve(process.cwd(), 'relatorios');

const MARGIN = 50;
const COL_VIDEO = 300;
const COL_SIM = 90;
const COL_STATUS = 110;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function statusLabel(item: BrandComparisonResult['items'][number]): string {
  if (item.status === 'sem-audio') return 'sem áudio';
  if (item.status === 'rodando') return 'RODANDO';
  return 'não encontrado';
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
  doc.text('Vídeo', MARGIN, y, { width: COL_VIDEO });
  doc.text('Similaridade', MARGIN + COL_VIDEO, y, { width: COL_SIM });
  doc.text('Status', MARGIN + COL_VIDEO + COL_SIM, y, { width: COL_STATUS });
  const lineY = y + 14;
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + COL_VIDEO + COL_SIM + COL_STATUS, lineY).strokeColor('#cccccc').stroke();
  return lineY + 6;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  const pageBottom = doc.page.height - MARGIN;
  if (y + needed > pageBottom) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function drawRow(doc: PDFKit.PDFDocument, item: BrandComparisonResult['items'][number], y: number): number {
  y = ensureSpace(doc, y, 20);

  const rodando = item.status === 'rodando';
  const semAudio = item.status === 'sem-audio';
  const flagRisco = rodando && item.semContrato;

  const nameSuffix = item.semContrato ? '  [SEM CONTRATO]' : '';
  const nameColor = flagRisco ? '#b00020' : semAudio ? '#888888' : '#000000';
  const simText = semAudio ? '—' : `${(item.similarity * 100).toFixed(0)}%`;
  const statusColor = flagRisco ? '#b00020' : rodando ? '#c0392b' : semAudio ? '#888888' : '#555555';

  doc.font(flagRisco ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(nameColor);
  const nameHeight = doc.heightOfString(item.name + nameSuffix, { width: COL_VIDEO });
  doc.text(item.name + nameSuffix, MARGIN, y, { width: COL_VIDEO });

  doc.font(rodando ? 'Helvetica-Bold' : 'Helvetica').fillColor(statusColor);
  doc.text(simText, MARGIN + COL_VIDEO, y, { width: COL_SIM });
  doc.text(statusLabel(item), MARGIN + COL_VIDEO + COL_SIM, y, { width: COL_STATUS });

  if (item.matchUrl) {
    doc.font('Helvetica').fontSize(7).fillColor('#1a73e8');
    doc.text(item.matchUrl, MARGIN + COL_VIDEO + COL_SIM, y + 11, { width: COL_STATUS + 40, link: item.matchUrl });
  }

  return y + Math.max(nameHeight, 12) + (item.matchUrl ? 12 : 4);
}

async function main() {
  const brands: Record<string, BrandConfig> = JSON.parse(fs.readFileSync(PAGE_IDS_PATH, 'utf-8'));
  const eligible = Object.entries(brands).filter(([, cfg]) => cfg.pageIds.length > 0);
  const skipped = Object.entries(brands).filter(([, cfg]) => cfg.pageIds.length === 0).map(([name]) => name);

  console.log(`Marcas a processar: ${eligible.map(([name]) => name).join(', ')}`);
  if (skipped.length > 0) console.log(`Marcas sem Page ID (puladas): ${skipped.join(', ')}`);

  const results: { marca: string; result?: BrandComparisonResult; error?: string }[] = [];
  for (const [marca, cfg] of eligible) {
    console.log(`\n--- Processando ${marca} ---`);
    try {
      const result = await compareBrand(marca, cfg);
      results.push({ marca, result });
      console.log(`${marca}: ${result.driveVideoCount} vídeo(s), ${result.activeAdCount} anúncio(s) ativo(s).`);
    } catch (err) {
      console.warn(`Falha ao processar ${marca}: ${(err as Error).message}`);
      results.push({ marca, error: (err as Error).message });
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `comparacao-${todayStr()}.pdf`);

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // Capa
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#000000').text('Relatório de Comparação de Criativos', { align: 'left' });
  doc.font('Helvetica').fontSize(11).fillColor('#555555').text(`LPX Marketing — ${todayStr()}`);
  doc.moveDown(1);

  // Resumo executivo
  const flagged = results.flatMap(({ marca, result }) =>
    (result?.items ?? []).filter((i) => i.status === 'rodando').map((i) => ({ marca, item: i }))
  );
  const flaggedSemContrato = flagged.filter((f) => f.item.semContrato);

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Resumo executivo');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  doc.text(`${eligible.length} marca(s) analisada(s). ${flagged.length} vídeo(s) confirmado(s) rodando como anúncio ativo, sendo ${flaggedSemContrato.length} marcado(s) *SEM CONTRATO*.`);
  doc.moveDown(0.5);

  if (flaggedSemContrato.length > 0) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b00020').text('⚠ Reuso sem contrato detectado:');
    doc.font('Helvetica').fontSize(9).fillColor('#b00020');
    for (const f of flaggedSemContrato) {
      doc.text(`• [${f.marca}] ${f.item.name} — ${(f.item.similarity * 100).toFixed(0)}% → ${f.item.matchUrl}`);
    }
    doc.moveDown(0.5);
  }

  const failed = results.filter((r) => r.error);
  if (failed.length > 0) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#888888').text('Marcas com falha no processamento (não incluídas abaixo):');
    doc.font('Helvetica').fontSize(9).fillColor('#888888');
    for (const f of failed) doc.text(`• ${f.marca}: ${f.error}`);
  }

  // Seções por marca
  for (const { marca, result } of results) {
    if (!result) continue;
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000').text(marca);
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    doc.text(`${result.driveVideoCount} vídeo(s) na pasta do Drive · ${result.activeAdCount} anúncio(s) em vídeo ativo(s) no Ad Library`);
    doc.moveDown(0.5);

    if (result.items.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#888888').text('Nenhum vídeo encontrado na pasta do Drive.');
      continue;
    }

    let y = drawTableHeader(doc, doc.y);
    for (const item of result.items) {
      y = ensureSpace(doc, y, 20);
      if (y === MARGIN) y = drawTableHeader(doc, y);
      y = drawRow(doc, item, y);
    }
  }

  doc.end();
  await new Promise<void>((resolve) => stream.on('finish', () => resolve()));

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
