import { readFileSync } from 'fs';
import { join } from 'path';
import {
  extractMarcaSection,
  extractCacheDate,
  readCacheFile,
  buildWebSearchProfile,
  appendToCache,
} from '@/lib/marca-lookup';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { marca, produto, nicho } = await req.json();

    let marcasContent = '';
    try {
      marcasContent = readFileSync(join(process.cwd(), 'reference', 'marcas-lpx.md'), 'utf-8');
    } catch {
      // proceed without the internal brand file if it's not accessible
    }

    const perfilInterno = extractMarcaSection(marcasContent, marca);
    if (perfilInterno) {
      return Response.json({
        perfil: perfilInterno,
        perfil_via_busca_web: false,
        perfil_do_cache: false,
      });
    }

    const cacheContent = readCacheFile();
    const perfilCache = extractMarcaSection(cacheContent, marca);
    if (perfilCache) {
      return Response.json({
        perfil: perfilCache,
        perfil_via_busca_web: true,
        perfil_do_cache: true,
        perfil_cache_data: extractCacheDate(perfilCache),
      });
    }

    const perfilBusca = await buildWebSearchProfile({ marca, produto, nicho });
    appendToCache(perfilBusca);

    return Response.json({
      perfil: perfilBusca,
      perfil_via_busca_web: true,
      perfil_do_cache: false,
    });
  } catch (error) {
    console.error('[brand-profile] error:', error);
    return Response.json({ perfil: '', perfil_via_busca_web: false, perfil_do_cache: false });
  }
}
