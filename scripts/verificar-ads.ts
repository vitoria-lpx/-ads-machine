import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDriveClient, findBrandFolder, listVideosInFolder, downloadDriveFile } from './lib/drive';
import { fetchActiveVideoAds } from './lib/apify';
import { transcribeGroq, downloadToTemp } from './lib/transcribe';
import { bestMatch, MATCH_THRESHOLD } from './lib/compare';

const PAGE_IDS_PATH = path.resolve(process.cwd(), 'reference', 'marcas-lpx-ads.json');

interface BrandConfig {
  pageIds: string[];
  /** Nome da pasta no Drive, se for diferente do nome da marca (busca por nome, pode ser ambíguo se houver duplicatas). */
  driveFolder?: string;
  /** ID da pasta no Drive (do link, ex: drive.google.com/drive/folders/{ID}). Se presente, tem prioridade sobre driveFolder -- evita ambiguidade de nomes duplicados. */
  driveFolderId?: string;
}

interface DriveTranscript {
  name: string;
  text: string;
}

interface AdTranscript {
  archiveId: string;
  libraryUrl: string;
  text: string;
}

async function main() {
  const marca = process.argv[2];
  if (!marca) {
    console.error('Uso: npm run verificar-ads -- "NomeDaMarca"');
    process.exit(1);
  }

  const brands: Record<string, BrandConfig> = JSON.parse(fs.readFileSync(PAGE_IDS_PATH, 'utf-8'));
  const brand = brands[marca];
  if (!brand || brand.pageIds.length === 0) {
    console.error(`Marca "${marca}" não tem Facebook Page ID cadastrado em reference/marcas-lpx-ads.json.`);
    console.error(`Marcas disponíveis: ${Object.keys(brands).join(', ')}`);
    process.exit(1);
  }
  const pageIds = brand.pageIds;
  const driveFolderName = brand.driveFolder ?? marca;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-machine-verificar-'));

  try {
    console.log(`\n=== 1. Google Drive: pasta "${brand.driveFolderId ?? driveFolderName}" ===`);
    const drive = await getDriveClient();
    const folderId = brand.driveFolderId ?? (await findBrandFolder(drive, driveFolderName));
    const videos = await listVideosInFolder(drive, folderId);
    console.log(`${videos.length} vídeo(s) encontrado(s) na pasta.`);

    const driveTranscripts: DriveTranscript[] = [];
    for (const video of videos) {
      const dest = path.join(tmpDir, `${video.id}${video.ext}`);
      console.log(`  Baixando: ${video.name}`);
      await downloadDriveFile(drive, video.id, dest);
      console.log(`  Transcrevendo: ${video.name}`);
      try {
        const { text } = await transcribeGroq(dest);
        driveTranscripts.push({ name: video.name, text });
      } catch (err) {
        console.warn(`  Falha ao transcrever ${video.name}: ${(err as Error).message}`);
        driveTranscripts.push({ name: video.name, text: '' });
      } finally {
        fs.unlinkSync(dest);
      }
    }

    console.log(`\n=== 2. Meta Ad Library: anúncios ativos de "${marca}" (Page IDs: ${pageIds.join(', ')}) ===`);
    const ads = await fetchActiveVideoAds(pageIds);
    console.log(`${ads.length} anúncio(s) em vídeo ativo(s) encontrado(s).`);

    const adTranscripts: AdTranscript[] = [];
    for (const ad of ads) {
      const dest = path.join(tmpDir, `${ad.archiveId}.mp4`);
      try {
        console.log(`  Baixando anúncio: ${ad.archiveId}`);
        await downloadToTemp(ad.videoUrl, dest);
        console.log(`  Transcrevendo anúncio: ${ad.archiveId}`);
        const { text } = await transcribeGroq(dest);
        adTranscripts.push({ archiveId: ad.archiveId, libraryUrl: ad.libraryUrl, text });
      } catch (err) {
        console.warn(`  Falha ao processar anúncio ${ad.archiveId}: ${(err as Error).message}`);
      } finally {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      }
    }

    console.log(`\n=== Resumo — ${marca} ===`);
    const candidateTexts = adTranscripts.map((a) => a.text);

    if (driveTranscripts.length === 0) {
      console.log('Nenhum vídeo encontrado na pasta do Drive.');
    }

    for (const dv of driveTranscripts) {
      if (!dv.text) {
        console.log(`- ${dv.name}: não transcrito (sem áudio ou falha na transcrição), não comparado`);
        continue;
      }

      const { index, rating } = bestMatch(dv.text, candidateTexts);
      if (index >= 0 && rating >= MATCH_THRESHOLD) {
        const matched = adTranscripts[index];
        console.log(`- ${dv.name}: RODANDO (${(rating * 100).toFixed(0)}% similar) -> ${matched.libraryUrl}`);
      } else {
        console.log(`- ${dv.name}: não encontrado rodando (melhor similaridade: ${(rating * 100).toFixed(0)}%)`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
