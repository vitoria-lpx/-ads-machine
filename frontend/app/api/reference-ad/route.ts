const ANGLE_MAP: Record<string, string> = {
  'Dor e solução':            'Pain-to-Solution',
  'Benefício e resultado':    'Benefit/Result',
  'Educação sobre o produto': 'Education',
  'Estilo de vida':           'Lifestyle/Aspiration',
  'Prova social':             'Social Proof',
  'Oferta e urgência':        'Offer/Urgency',
};

type NotionPage = { id: string; properties: Record<string, any> };

let cachedDbId: string | null = null;

async function getSwipeDbId(token: string): Promise<string | null> {
  if (cachedDbId) return cachedDbId;
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({ query: 'Swipe File', filter: { property: 'object', value: 'database' } }),
  });
  const data = await res.json();
  const db = (data.results ?? []).find(
    (r: any) => r.object === 'database' && r.title?.[0]?.plain_text === 'Swipe File',
  );
  if (db) cachedDbId = db.id;
  return cachedDbId;
}

async function queryNotion(token: string, dbId: string, filter: object): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    const data = await res.json();
    pages.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function getStr(page: NotionPage, prop: string): string {
  const p = page.properties[prop];
  if (!p) return '';
  if (p.type === 'url')       return p.url ?? '';
  if (p.type === 'select')    return p.select?.name ?? '';
  if (p.type === 'rich_text') return p.rich_text?.[0]?.plain_text ?? '';
  if (p.type === 'number')    return String(p.number ?? 0);
  return '';
}

function pick(pages: NotionPage[], fallback: boolean) {
  const page = pages[Math.floor(Math.random() * pages.length)];
  return {
    found: true as const,
    competitor:    getStr(page, 'Competitor'),
    adLibraryUrl:  getStr(page, 'Ad Library URL'),
    daysActive:    Number(page.properties['Days Active']?.number ?? 0),
    angleCategory: getStr(page, 'Angle Category'),
    fallback,
  };
}

export async function POST(req: Request) {
  try {
    const { nicho, angulo } = await req.json();
    const token = process.env.NOTION_TOKEN;
    if (!token) return Response.json({ found: false });

    const dbId = await getSwipeDbId(token);
    if (!dbId) return Response.json({ found: false });

    const angleValue = ANGLE_MAP[angulo] ?? angulo;
    const base = [
      { property: 'Longevity Tier',   select: { equals: 'Long-Runner' } },
      { property: 'Ad Active Status', select: { equals: 'Active' } },
      { property: 'Ad Library URL',   url:    { is_not_empty: true } },
    ];

    // Tentativa 1 — nicho + ângulo
    const pages1 = await queryNotion(token, dbId, {
      and: [
        { property: 'Nicho',          select: { equals: nicho } },
        { property: 'Angle Category', select: { equals: angleValue } },
        ...base,
      ],
    });
    if (pages1.length > 0) return Response.json(pick(pages1, false));

    // Tentativa 2 — só nicho
    const pages2 = await queryNotion(token, dbId, {
      and: [
        { property: 'Nicho', select: { equals: nicho } },
        ...base,
      ],
    });
    if (pages2.length > 0) return Response.json(pick(pages2, true));

    return Response.json({ found: false });
  } catch (error) {
    console.error('[reference-ad] error:', error);
    return Response.json({ found: false });
  }
}
