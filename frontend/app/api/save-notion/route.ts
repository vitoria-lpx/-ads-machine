import { Client } from '@notionhq/client';

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
  if (existing) return existing.id;

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Briefings Gerados' } }],
    properties: {
      'Título':          { title: {} },
      'Nicho':           { select: { options: [
        { name: 'Beleza',   color: 'pink' },
        { name: 'Moda',     color: 'purple' },
        { name: 'Wellness', color: 'green' },
      ]}},
      'Ângulo':          { select: { options: [] } },
      'Formato':         { select: { options: [] } },
      'Duração':         { select: { options: [] } },
      'Data de geração': { date: {} },
    },
  });
  return db.id;
}

function toBlocks(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 2000) chunks.push(text.slice(i, i + 2000));
  return chunks.map(chunk => ({
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: { rich_text: [{ type: 'text' as const, text: { content: chunk } }] },
  }));
}

export async function POST(req: Request) {
  try {
    const { briefing, marca, produto, nicho, angulo, formato, duracao } = await req.json();

    const token = process.env.NOTION_TOKEN;
    if (!token) return Response.json({ error: 'NOTION_TOKEN não configurado' }, { status: 500 });

    const notion = new Client({ auth: token });
    const parentPageId = '38a3ef898c4e80dfa9e7ce94964af165';

    const databaseId = await getOrCreateDatabase(notion, parentPageId);

    await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        'Título':          { title: [{ text: { content: `${marca} — ${produto}` } }] },
        'Nicho':           { select: { name: nicho } },
        'Ângulo':          { select: { name: angulo } },
        'Formato':         { select: { name: formato } },
        'Duração':         { select: { name: duracao } },
        'Data de geração': { date: { start: new Date().toISOString().split('T')[0] } },
      },
      children: toBlocks(briefing),
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
