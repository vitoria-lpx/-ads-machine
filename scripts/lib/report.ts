import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDriveClient, findBrandFolder, listVideosInFolder, downloadDriveFile } from './drive';
import { fetchActiveVideoAds } from './apify';
import { transcribeGroq, downloadToTemp } from './transcribe';
import { bestMatch, MATCH_THRESHOLD } from './compare';

export interface BrandConfig {
  pageIds: string[];
  /** Nome da pasta no Drive, se for diferente do nome da marca (busca por nome, pode ser ambíguo se houver duplicatas). */
  driveFolder?: string;
  /** ID da pasta no Drive (do link, ex: drive.google.com/drive/folders/{ID}). Se presente, tem prioridade sobre driveFolder -- evita ambiguidade de nomes duplicados. */
  driveFolderId?: string;
}

export type ComparisonStatus = 'rodando' | 'nao-encontrado' | 'sem-audio';

export interface ComparisonItem {
  name: string;
  status: ComparisonStatus;
  similarity: number;
  matchUrl?: string;
  semContrato: boolean;
}

export interface BrandComparisonResult {
  marca: string;
  driveVideoCount: number;
  activeAdCount: number;
  items: ComparisonItem[];
}

/**
 * Roda o mesmo fluxo do verificar-ads.ts (Drive -> transcrição -> Ad Library -> transcrição -> comparação)
 * mas retorna dados estruturados em vez de imprimir no console, pra poder ser usado tanto pelo CLI single-brand
 * quanto pelo relatório multi-marca.
 */
export async function compareBrand(marca: string, brand: BrandConfig): Promise<BrandComparisonResult> {
  const driveFolderName = brand.driveFolder ?? marca;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-machine-compare-'));

  try {
    const drive = await getDriveClient();
    const folderId = brand.driveFolderId ?? (await findBrandFolder(drive, driveFolderName));
    const videos = await listVideosInFolder(drive, folderId);

    const driveTranscripts: { name: string; text: string; semContrato: boolean }[] = [];
    for (const video of videos) {
      const dest = path.join(tmpDir, `${video.id}${video.ext}`);
      const semContrato = video.name.toUpperCase().includes('SEM CONTRATO');
      await downloadDriveFile(drive, video.id, dest);
      try {
        const { text } = await transcribeGroq(dest);
        driveTranscripts.push({ name: video.name, text, semContrato });
      } catch {
        driveTranscripts.push({ name: video.name, text: '', semContrato });
      } finally {
        fs.unlinkSync(dest);
      }
    }

    const ads = await fetchActiveVideoAds(brand.pageIds);
    const adTranscripts: { archiveId: string; libraryUrl: string; text: string }[] = [];
    for (const ad of ads) {
      const dest = path.join(tmpDir, `${ad.archiveId}.mp4`);
      try {
        await downloadToTemp(ad.videoUrl, dest);
        const { text } = await transcribeGroq(dest);
        adTranscripts.push({ archiveId: ad.archiveId, libraryUrl: ad.libraryUrl, text });
      } catch {
        // anúncio não entra na comparação -- não é possível confirmar nem descartar reuso pra ele
      } finally {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      }
    }

    const candidateTexts = adTranscripts.map((a) => a.text);
    const items: ComparisonItem[] = driveTranscripts.map((dv) => {
      if (!dv.text) {
        return { name: dv.name, status: 'sem-audio', similarity: 0, semContrato: dv.semContrato };
      }
      const { index, rating } = bestMatch(dv.text, candidateTexts);
      const rodando = index >= 0 && rating >= MATCH_THRESHOLD;
      return {
        name: dv.name,
        status: rodando ? 'rodando' : 'nao-encontrado',
        similarity: rating,
        matchUrl: rodando ? adTranscripts[index].libraryUrl : undefined,
        semContrato: dv.semContrato,
      };
    });

    items.sort((a, b) => b.similarity - a.similarity);

    return { marca, driveVideoCount: videos.length, activeAdCount: ads.length, items };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
