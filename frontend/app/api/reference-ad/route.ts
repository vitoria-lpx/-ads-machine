import { Client } from '@notionhq/client';

const DB_ID = '3903ef89-8c4e-81d2-8d90-f9a2637204a0';

function getStr(page: any, prop: string): string {
  const p = page.properties[prop];
  if (!p) return '';
  if (p.type === 'url')       return p.url ?? '';
  if (p.type === 'select')    return p.select?.name ?? '';
  if (p.type === 'number')    return String(p.number ?? 0);
  if (p.type === 'rich_text') return (p.rich_text ?? []).map((r: any) => r.plain_text ?? '').join('');
  return '';
}

export async function POST(req: Request) {
  try {
    const { nicho } = await req.json();
    const token = process.env.NOTION_TOKEN;
    if (!token) return Response.json({ found: false });

    const notion = new Client({ auth: token });

    const baseFilters = [
      { property: 'Pipeline Status', select: { equals: 'Ready' } },
      { property: 'Display Format',  select: { equals: 'VIDEO' } },
      { property: 'Video URL',       url:    { is_not_empty: true } },
    ];

    // Attempt 1: with Nicho filter
    const res1 = await notion.databases.query({
      database_id: DB_ID,
      filter: { and: [...baseFilters, { property: 'Nicho', select: { equals: nicho } }] } as any,
      sorts: [{ property: 'Days Active', direction: 'descending' }],
      page_size: 5,
    });

    let pages = res1.results;
    let nicho_divergente = false;

    if (pages.length === 0) {
      const res2 = await notion.databases.query({
        database_id: DB_ID,
        filter: { and: baseFilters } as any,
        sorts: [{ property: 'Days Active', direction: 'descending' }],
        page_size: 5,
      });
      pages = res2.results;
      nicho_divergente = true;
    }

    if (pages.length === 0) return Response.json({ found: false });

    const page = pages[Math.floor(Math.random() * pages.length)] as any;

    const videoUrl      = getStr(page, 'Video URL');
    const angleCategory = getStr(page, 'Angle Category');
    const nicho_val     = getStr(page, 'Nicho');

    return Response.json({
      found:         true,
      competitor:    getStr(page, 'Competitor'),
      adLibraryUrl:  getStr(page, 'Ad Library URL'),
      daysActive:    Number(page.properties['Days Active']?.number ?? 0),
      hookCopy:      getStr(page, 'Hook Copy'),
      transcript:    getStr(page, 'Transcript'),
      angleCategory,
      visualStyle:   getStr(page, 'Visual Style'),
      videoUrl,
      nicho:         nicho_val,
      nicho_divergente,
    });
  } catch (error) {
    console.error('[reference-ad] error:', error);
    return Response.json({ found: false });
  }
}
