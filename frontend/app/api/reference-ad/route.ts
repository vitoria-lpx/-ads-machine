const ANGLE_MAP: Record<string, string> = {
  'Dor e solução':            'Pain-to-Solution',
  'Benefício e resultado':    'Benefit/Result',
  'Educação sobre o produto': 'Education',
  'Estilo de vida':           'Lifestyle/Aspiration',
  'Prova social':             'Social Proof',
  'Oferta e urgência':        'Offer/Urgency',
};

type AirtableRecord = { fields: Record<string, string | number> };

async function queryAirtable(apiKey: string, baseId: string, formula: string): Promise<AirtableRecord[]> {
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: '50' });
  ['Competitor', 'Ad Library URL', 'Days Active', 'Angle Category'].forEach(f =>
    params.append('fields[]', f),
  );

  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/tbl4zG1dsIWSzXUoT?${params}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const data = await res.json();
  return data.records ?? [];
}

function pick(records: AirtableRecord[], fallback: boolean) {
  const rec = records[Math.floor(Math.random() * records.length)];
  return {
    found: true as const,
    competitor:    String(rec.fields['Competitor'] ?? ''),
    adLibraryUrl:  String(rec.fields['Ad Library URL'] ?? ''),
    daysActive:    Number(rec.fields['Days Active'] ?? 0),
    angleCategory: String(rec.fields['Angle Category'] ?? ''),
    fallback,
  };
}

export async function POST(req: Request) {
  try {
    const { nicho, angulo } = await req.json();

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID ?? 'appACpl3rkO8fB2nH';
    if (!apiKey) return Response.json({ found: false });

    const angleValue = ANGLE_MAP[angulo] ?? angulo;
    const base = `{Longevity Tier}="Long-Runner",{Ad Active Status}="Active",NOT({Ad Library URL}="")`;

    // Tentativa 1 — nicho + ângulo exato
    const records1 = await queryAirtable(
      apiKey, baseId,
      `AND({Nicho}="${nicho}",{Angle Category}="${angleValue}",${base})`,
    );
    if (records1.length > 0) return Response.json(pick(records1, false));

    // Tentativa 2 — só nicho
    const records2 = await queryAirtable(
      apiKey, baseId,
      `AND({Nicho}="${nicho}",${base})`,
    );
    if (records2.length > 0) return Response.json(pick(records2, true));

    return Response.json({ found: false });
  } catch (error) {
    console.error('[reference-ad] error:', error);
    return Response.json({ found: false });
  }
}
