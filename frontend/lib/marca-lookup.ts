import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { Client } from '@notionhq/client';

const CACHE_DATE_RE = /_Perfil gerado via busca web em (\d{2}\/\d{2}\/\d{4})/;
const CACHE_DB_NAME = 'Perfis de Marcas (Busca Web)';
const CACHE_PARENT_PAGE_ID = '38a3ef898c4e80dfa9e7ce94964af165';

// ─── Section extraction (shared by marcas-lpx.md and marcas-web-cache.md) ─────

export function extractMarcaSection(content: string, marca: string): string {
  if (!content || !marca) return '';
  const marcaLower = marca.trim().toLowerCase();
  const lines = content.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      const headerLower = lines[i].slice(3).toLowerCase();
      if (headerLower.includes(marcaLower) || marcaLower.split(' ').some(w => w.length > 3 && headerLower.includes(w))) {
        start = i;
      } else if (start !== -1) {
        return lines.slice(start, i).join('\n').trim();
      }
    }
  }

  return start !== -1 ? lines.slice(start).join('\n').trim() : '';
}

export function extractCacheDate(section: string): string | undefined {
  return CACHE_DATE_RE.exec(section)?.[1];
}

// ─── Notion-backed cache (unregistered brands looked up via web search) ───────
//
// Vercel functions run on a read-only filesystem (except /tmp, which isn't
// shared across invocations or persisted across deploys), so this cache
// can't live on disk in production — it's a small Notion database instead,
// following the same get-or-create pattern as app/api/save-notion/route.ts.

async function getOrCreateCacheDb(notion: Client): Promise<string> {
  const search = await notion.search({
    query: CACHE_DB_NAME,
    filter: { property: 'object', value: 'database' },
  });

  const existing = search.results.find(
    (r: any) => r.object === 'database' && r.title?.some((t: any) => t.plain_text === CACHE_DB_NAME),
  );
  if (existing) return existing.id;

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: CACHE_PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: CACHE_DB_NAME } }],
    properties: {
      'Marca': { title: {} },
    },
  });
  return db.id;
}

function textToBlocks(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 2000) chunks.push(text.slice(i, i + 2000));
  return chunks.map(chunk => ({
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: { rich_text: [{ type: 'text' as const, text: { content: chunk } }] },
  }));
}

async function blocksToText(notion: Client, pageId: string): Promise<string> {
  let text = '';
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    for (const block of res.results as any[]) {
      if (block.type === 'paragraph') {
        text += (block.paragraph.rich_text ?? []).map((r: any) => r.plain_text ?? '').join('');
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return text.trim();
}

export async function findCachedProfile(notion: Client, marca: string): Promise<string> {
  if (!marca) return '';
  const marcaLower = marca.trim().toLowerCase();

  const dbId = await getOrCreateCacheDb(notion);
  const res = await notion.databases.query({ database_id: dbId, page_size: 100 });

  const match = (res.results as any[]).find(page => {
    const title = (page.properties?.Marca?.title ?? []).map((t: any) => t.plain_text ?? '').join('').toLowerCase();
    if (!title) return false;
    return title === marcaLower || marcaLower.split(' ').some(w => w.length > 3 && title.includes(w));
  });
  if (!match) return '';

  return blocksToText(notion, match.id);
}

export async function saveProfileToCache(notion: Client, profileMarkdown: string): Promise<void> {
  const marca = /^## (.+)$/m.exec(profileMarkdown)?.[1]?.trim() ?? 'DESCONHECIDA';
  const dbId = await getOrCreateCacheDb(notion);

  await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      'Marca': { title: [{ text: { content: marca } }] },
    },
    children: textToBlocks(profileMarkdown),
  });
}

// ─── Web search fallback ───────────────────────────────────────────────────────

function formatDatePtBr(date: Date): string {
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export async function buildWebSearchProfile(inputs: { marca: string; produto: string; nicho: string }): Promise<string> {
  const { marca, produto, nicho } = inputs;

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    tools: {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
    },
    prompt: `Pesquise na web sobre a marca "${marca}" e o produto "${produto}" (nicho: ${nicho}). Busque especificamente:
- O que é o produto/marca
- Principais diferenciais
- Público-alvo
- Tom de comunicação da marca (pelo site e redes sociais, se identificável)

Responda SOMENTE com o perfil da marca no formato markdown abaixo, sem nenhum texto antes ou depois:

**Nicho:** ${nicho}

**O que é:**
{2-4 frases}

**Diferenciais:**
- {bullet}
- {bullet}

**Público:**
{1-3 frases}

**Tom de voz:**
{1-2 frases}`,
  });

  const dataGeracao = formatDatePtBr(new Date());

  return `## ${marca.trim().toUpperCase()}
_Perfil gerado via busca web em ${dataGeracao} — não revisado pela equipe LPX_

${text.trim()}`;
}
