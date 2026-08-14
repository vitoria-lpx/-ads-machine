import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { compareBrand, BrandConfig } from './lib/report';

const PAGE_IDS_PATH = path.resolve(process.cwd(), 'reference', 'marcas-lpx-ads.json');

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

  console.log(`\n=== 1. Google Drive: pasta "${brand.driveFolderId ?? brand.driveFolder ?? marca}" ===`);
  console.log(`\n=== 2. Meta Ad Library: anúncios ativos de "${marca}" (Page IDs: ${brand.pageIds.join(', ')}) ===`);

  const result = await compareBrand(marca, brand);

  console.log(`${result.driveVideoCount} vídeo(s) na pasta, ${result.activeAdCount} anúncio(s) em vídeo ativo(s).`);
  console.log(`\n=== Resumo — ${marca} ===`);

  if (result.items.length === 0) {
    console.log('Nenhum vídeo encontrado na pasta do Drive.');
  }

  for (const item of result.items) {
    if (item.status === 'sem-audio') {
      console.log(`- ${item.name}: não transcrito (sem áudio ou falha na transcrição), não comparado`);
    } else if (item.status === 'rodando') {
      console.log(`- ${item.name}: RODANDO (${(item.similarity * 100).toFixed(0)}% similar) -> ${item.matchUrl}`);
    } else {
      console.log(`- ${item.name}: não encontrado rodando (melhor similaridade: ${(item.similarity * 100).toFixed(0)}%)`);
    }
  }
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
