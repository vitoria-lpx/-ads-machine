import { Client } from '@notionhq/client';

const NEW_PROPERTIES = {
  'Campanha':            { rich_text: {} },
  'Data de postagem':    { rich_text: {} },
  'Escopo de entrega':   { rich_text: {} },
  'Objetivo':            { rich_text: {} },
  'Criativo Inspiração': { url: {} },
};

async function getOrCreateDatabase(notion: Client, parentPageId: string): Promise<string> {
  const search = await notion.search({
    query: 'Briefings Gerados',
    filter: { property: 'object', value: 'database' },
  });

  const existing = search.results.find(
    (r: { object: string; id: string; title?: { plain_text: string }[] }) =>
      r.object === 'database' &&
      r.title?.some(t => t.plain_text === 'Briefings Gerados'),
  );
  if (existing) {
    const db = await notion.databases.retrieve({ database_id: existing.id });
    const currentProps = (db as { properties: Record<string, unknown> }).properties;
    const missing = Object.fromEntries(
      Object.entries(NEW_PROPERTIES).filter(([name]) => !(name in currentProps)),
    );
    if (Object.keys(missing).length > 0) {
      await notion.databases.update({
        database_id: existing.id,
        properties: missing,
      });
    }
    return existing.id;
  }

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Briefings Gerados' } }],
    properties: {
      'Título':              { title: {} },
      'Nicho':               { select: { options: [
        { name: 'Beleza',   color: 'pink' },
        { name: 'Moda',     color: 'purple' },
        { name: 'Wellness', color: 'green' },
      ]}},
      'Ângulo':              { select: { options: [] } },
      'Formato':             { select: { options: [] } },
      'Duração':             { select: { options: [] } },
      'Data de geração':     { date: {} },
      ...NEW_PROPERTIES,
    },
  });
  return db.id;
}

function richText(text: string) {
  return text.length > 2000 ? text.slice(0, 1997) + '...' : text;
}

function heading(text: string) {
  return {
    object: 'block' as const,
    type: 'heading_3' as const,
    heading_3: { rich_text: [{ type: 'text' as const, text: { content: text } }] },
  };
}

function paragraph(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 2000) chunks.push(text.slice(i, i + 2000));
  return chunks.map(chunk => ({
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: { rich_text: [{ type: 'text' as const, text: { content: chunk } }] },
  }));
}

function bulletedList(items: string[]) {
  return items.map(item => ({
    object: 'block' as const,
    type: 'bulleted_list_item' as const,
    bulleted_list_item: { rich_text: [{ type: 'text' as const, text: { content: item } }] },
  }));
}

export async function POST(req: Request) {
  try {
    const {
      marca, produto, nicho, angulo, formato, duracao, adLibraryUrl,
      campanha, dataPostagem, escopoEntrega, objetivo, hook, corpo, cta, dicasQueValemOuro,
    } = await req.json();

    const token = process.env.NOTION_TOKEN;
    if (!token) return Response.json({ error: 'NOTION_TOKEN não configurado' }, { status: 500 });

    const notion = new Client({ auth: token });
    const parentPageId = '38a3ef898c4e80dfa9e7ce94964af165';

    const databaseId = await getOrCreateDatabase(notion, parentPageId);

    const children = [
      heading('Objetivo'),
      ...paragraph(objetivo ?? ''),
      heading('Hook'),
      ...paragraph(hook ?? ''),
      heading('Corpo'),
      ...paragraph(corpo ?? ''),
      heading('CTA'),
      ...paragraph(cta ?? ''),
      heading('Dicas que valem ouro'),
      ...bulletedList(Array.isArray(dicasQueValemOuro) ? dicasQueValemOuro : []),
    ];

    await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        'Título':            { title: [{ text: { content: `${marca} — ${produto}` } }] },
        'Nicho':             { select: { name: nicho } },
        ...(angulo ? { 'Ângulo': { select: { name: angulo } } } : {}),
        'Formato':           { select: { name: formato } },
        'Duração':           { select: { name: duracao } },
        'Data de geração':   { date: { start: new Date().toISOString().split('T')[0] } },
        'Campanha':          { rich_text: [{ text: { content: richText(campanha ?? '') } }] },
        'Data de postagem':  { rich_text: [{ text: { content: richText(dataPostagem ?? '') } }] },
        'Escopo de entrega': { rich_text: [{ text: { content: richText(escopoEntrega ?? '') } }] },
        'Objetivo':          { rich_text: [{ text: { content: richText(objetivo ?? '') } }] },
        ...(adLibraryUrl ? { 'Criativo Inspiração': { url: adLibraryUrl } } : {}),
      },
      children,
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('[save-notion] error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
