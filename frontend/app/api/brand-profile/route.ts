import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from '@notionhq/client';
import {
  extractMarcaSection,
  extractCacheDate,
  findCachedProfile,
  buildWebSearchProfile,
  saveProfileToCache,
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

    const token = process.env.NOTION_TOKEN;
    const notion = token ? new Client({ auth: token }) : null;

    if (notion) {
      const perfilCache = await findCachedProfile(notion, marca).catch(err => {
        console.error('[brand-profile] cache lookup failed:', err);
        return '';
      });
      if (perfilCache) {
        return Response.json({
          perfil: perfilCache,
          perfil_via_busca_web: true,
          perfil_do_cache: true,
          perfil_cache_data: extractCacheDate(perfilCache),
        });
      }
    }

    const perfilBusca = await buildWebSearchProfile({ marca, produto, nicho });

    // Cache write is best-effort — a Notion outage must not cost the analyst
    // the profile that was just generated (this used to fail silently by
    // throwing before the response was built, back when the cache lived on
    // Vercel's read-only filesystem).
    if (notion) {
      await saveProfileToCache(notion, perfilBusca).catch(err => {
        console.error('[brand-profile] failed to cache profile:', err);
      });
    }

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
