import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_PATH = join(process.cwd(), 'reference', 'marcas-web-cache.md');
const CACHE_DATE_RE = /_Perfil gerado via busca web em (\d{2}\/\d{2}\/\d{4})/;

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

export function readCacheFile(): string {
  try {
    return readFileSync(CACHE_PATH, 'utf-8');
  } catch {
    return '';
  }
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

export function appendToCache(profileMarkdown: string): void {
  // Separators go BETWEEN entries only (never trailing) — extractMarcaSection
  // returns everything to EOF for the last section in a file, so a trailing
  // "---" would otherwise leak into the profile text handed to the model.
  if (!existsSync(CACHE_PATH)) {
    const header = `# Perfis de Marcas — Cache de Busca Web
Gerado automaticamente pelo gerador de briefing quando a marca não está cadastrada em marcas-lpx.md.
Perfis aqui não foram revisados pela equipe LPX — tratar com cautela, especialmente quanto a regras de conteúdo específicas da marca.

`;
    writeFileSync(CACHE_PATH, header + profileMarkdown + '\n', 'utf-8');
  } else {
    appendFileSync(CACHE_PATH, '\n---\n\n' + profileMarkdown + '\n', 'utf-8');
  }
}
