'use client';

import { experimental_useObject as useObject } from '@ai-sdk/react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { briefingSchema } from '@/lib/system-prompt';
import { downloadBriefingPdf } from '@/lib/pdf-export';
import { splitSceneSegments } from '@/lib/scene-format';

const NICHOS = ['Beleza', 'Moda', 'Wellness'];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 16 16" fill="none"
      className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * html2canvas has a persistent bug (confirmed across four different CSS
 * centering techniques — padding, line-height, flexbox, forced height) where
 * it draws this badge's text glyphs bottom-anchored instead of centered,
 * even though the container box itself is captured at the correct size.
 * Rendering it as an SVG image sidesteps html2canvas's text layout entirely —
 * the browser rasterizes the SVG (with reliable dominant-baseline centering)
 * before html2canvas ever sees it, the same way it already correctly
 * captures the logo <img> everywhere else.
 */
function EscopoBadge({ text }: { text: string }) {
  const HEIGHT = 24;
  const PADDING_X = 12;
  const FONT_SIZE = 12;
  const LETTER_SPACING = 0.3;

  const width = useMemo(() => {
    if (typeof document === 'undefined') return 200;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 200;
    ctx.font = `700 ${FONT_SIZE}px Montserrat, sans-serif`;
    const upper = text.toUpperCase();
    const textWidth = ctx.measureText(upper).width + LETTER_SPACING * upper.length;
    return Math.ceil(textWidth) + PADDING_X * 2;
  }, [text]);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}">
    <rect width="${width}" height="${HEIGHT}" rx="${HEIGHT / 2}" ry="${HEIGHT / 2}" fill="#fdf0ff"/>
    <text x="50%" y="50%" dy="1.75" text-anchor="middle" dominant-baseline="central" font-family="Montserrat, sans-serif" font-size="${FONT_SIZE}" font-weight="700" letter-spacing="${LETTER_SPACING}" fill="#94089B">${text.toUpperCase()}</text>
  </svg>`;

  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt={text}
      width={width}
      height={HEIGHT}
      style={{ width: `${width}px`, height: `${HEIGHT}px` }}
    />
  );
}

function SceneFormattedText({ text }: { text: string }) {
  return (
    <>
      {splitSceneSegments(text).map((segment, i) =>
        segment.isDirection ? <em key={i}>{segment.text}</em> : <span key={i}>{segment.text}</span>,
      )}
    </>
  );
}

function AutoTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={1}
        className={`field-lpx ${className ?? ''} ${focused ? '' : 'text-transparent'}`}
      />
      {!focused && (
        <div
          aria-hidden="true"
          className={`field-lpx pointer-events-none absolute inset-0 whitespace-pre-wrap ${className ?? ''}`}
          style={{ overflow: 'visible', overflowWrap: 'break-word' }}
        >
          <SceneFormattedText text={value} />
        </div>
      )}
    </div>
  );
}

type RefAd =
  | {
      found: true;
      competitor: string;
      adLibraryUrl: string;
      daysActive: number;
      hookCopy: string;
      transcript: string;
      angleCategory: string;
      visualStyle: string;
      videoUrl: string;
      nicho: string;
      nicho_divergente: boolean;
    }
  | { found: false };

type BrandProfile = {
  perfil: string;
  perfil_via_busca_web: boolean;
  perfil_do_cache: boolean;
  perfil_cache_data?: string;
};

function formatBriefingText(fields: {
  campanha: string;
  dataPostagem: string;
  escopoEntrega: string;
  objetivo?: string;
  hook?: string;
  corpo?: string;
  cta?: string;
  dicasQueValemOuro?: (string | undefined)[];
}) {
  const dicas = (fields.dicasQueValemOuro ?? []).filter((d): d is string => !!d);
  return `Campanha: ${fields.campanha}
Data de postagem: ${fields.dataPostagem}
Escopo de entrega: ${fields.escopoEntrega}
Objetivo: ${fields.objetivo ?? ''}

Hook:
${fields.hook ?? ''}

Corpo:
${fields.corpo ?? ''}

CTA:
${fields.cta ?? ''}

Dicas que valem ouro:
${dicas.map(d => `- ${d}`).join('\n')}`;
}

type EditedFields = {
  objetivo: string;
  hook: string;
  corpo: string;
  cta: string;
  dicas: string[];
};

export default function Home() {
  const [form, setForm] = useState({ marca: '', produto: '', nicho: '' });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notionStatus, setNotionStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notionError, setNotionError] = useState('');
  const [refAd, setRefAd] = useState<RefAd | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [isFetchingRef, setIsFetchingRef] = useState(false);
  const [edited, setEdited] = useState<EditedFields>({ objetivo: '', hook: '', corpo: '', cta: '', dicas: [] });
  const [userEdited, setUserEdited] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const { object, submit, isLoading } = useObject({
    api: '/api/generate',
    schema: briefingSchema,
  });

  const isWorking = isFetchingRef || isLoading;

  const campanha = form.marca ? `Campanha influenciadores ${form.marca}` : '';
  const dataPostagem = 'A combinar';
  const escopoEntrega = 'Reels em até 1 minuto';

  // While the AI is still streaming, the edited fields mirror `object` live.
  // Once the analyst types anything, `userEdited` locks in and further
  // streaming updates (there are none after the stream ends) stop overwriting it.
  const streamedFields: EditedFields = {
    objetivo: object?.objetivo ?? '',
    hook: object?.hook ?? '',
    corpo: object?.corpo ?? '',
    cta: object?.cta ?? '',
    dicas: (object?.dicasQueValemOuro ?? []).filter((d): d is string => !!d),
  };
  const displayed = userEdited ? edited : streamedFields;

  const updateField = (key: 'objetivo' | 'hook' | 'corpo' | 'cta') => (value: string) => {
    setEdited(prev => ({ ...(userEdited ? prev : streamedFields), [key]: value }));
    setUserEdited(true);
  };

  const updateDica = (index: number) => (value: string) => {
    setEdited(prev => {
      const base = userEdited ? prev : streamedFields;
      const dicas = base.dicas.slice();
      dicas[index] = value;
      return { ...base, dicas };
    });
    setUserEdited(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.marca || !form.produto || !form.nicho) return;
    setRefAd(null);
    setBrandProfile(null);
    setIsFetchingRef(true);
    setUserEdited(false);
    setEdited({ objetivo: '', hook: '', corpo: '', cta: '', dicas: [] });

    let refAdData: RefAd = { found: false };
    let brandProfileData: BrandProfile | null = null;
    try {
      const [refRes, brandRes] = await Promise.all([
        fetch('/api/reference-ad', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho: form.nicho }),
        }),
        fetch('/api/brand-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marca: form.marca, produto: form.produto, nicho: form.nicho }),
        }),
      ]);
      refAdData = await refRes.json();
      brandProfileData = await brandRes.json();
      setRefAd(refAdData);
      setBrandProfile(brandProfileData);
    } catch {
      refAdData = { found: false };
    } finally {
      setIsFetchingRef(false);
    }

    submit({
      marca:   form.marca,
      produto: form.produto,
      nicho:   form.nicho,
      refAd:   refAdData.found ? refAdData : null,
      perfil:  brandProfileData?.perfil ?? '',
    });
  };

  const handleSaveNotion = async () => {
    setNotionStatus('saving');
    setNotionError('');
    try {
      const res = await fetch('/api/save-notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marca:    form.marca,
          produto:  form.produto,
          nicho:    form.nicho,
          angulo:      refAd?.found ? refAd.angleCategory : '',
          formato:     'Reels',
          duracao:     'até 1min',
          adLibraryUrl: refAd?.found ? refAd.adLibraryUrl : '',
          campanha,
          dataPostagem,
          escopoEntrega,
          objetivo: displayed.objetivo,
          hook:     displayed.hook,
          corpo:    displayed.corpo,
          cta:      displayed.cta,
          dicasQueValemOuro: displayed.dicas,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar');
      setNotionStatus('saved');
      setTimeout(() => setNotionStatus('idle'), 3000);
    } catch (err) {
      setNotionError(err instanceof Error ? err.message : 'Erro ao salvar');
      setNotionStatus('error');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      formatBriefingText({
        campanha,
        dataPostagem,
        escopoEntrega,
        objetivo: displayed.objetivo,
        hook: displayed.hook,
        corpo: displayed.corpo,
        cta: displayed.cta,
        dicasQueValemOuro: displayed.dicas,
      }),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = async () => {
    if (!pdfRef.current) return;
    setIsDownloadingPdf(true);
    try {
      await downloadBriefingPdf(pdfRef.current, form.marca, form.produto);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const field = (label: string, key: keyof typeof form, placeholder: string) => (
    <div>
      <label className="block text-sm font-medium text-[#1a1a1a] mb-1">{label}</label>
      <input
        type="text"
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        required
        className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm input-lpx transition text-[#1a1a1a] placeholder:text-[#999999]"
      />
    </div>
  );

  const nichoOptions = NICHOS.map(n => ({ value: n, label: n }));
  const selectedNicho = nichoOptions.find(o => o.value === form.nicho);

  const hasOutput = !!(object?.objetivo || object?.hook || object?.corpo || object?.cta);

  return (
    <div className="min-h-screen bg-[#f4f4f4]">
      {openDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
      )}

      {/* Header */}
      <header className="bg-white border-b border-[#e0e0e0] px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <img src="/logor5.png" alt="LPX" className="h-[120px]" />
          <span className="text-sm font-semibold px-3 py-1 rounded-full border border-[#EF27FF] text-[#EF27FF] bg-[#fdf0ff]">
            Gerador de Briefing
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-6">
        {/* Formulário */}
        <aside className="w-full lg:w-[320px] shrink-0">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[#e0e0e0] p-6 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-[#1a1a1a] uppercase tracking-wider mb-1">Adaptar anúncio validado</h2>
              <p className="text-xs text-[#666666] leading-relaxed">
                O sistema busca um anúncio de concorrente que já performou bem (60+ dias no ar) e adapta a copy para a sua marca.
              </p>
            </div>

            {field('Marca', 'marca', 'Ex: LUMI, Menina Web, Hoomy')}
            {field('Produto', 'produto', 'Ex: blend de fibras em pó, fluido desmaia fios')}

            {/* Nicho */}
            <div>
              <label className="block text-sm font-medium text-[#1a1a1a] mb-2">Nicho</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenDropdown(openDropdown === 'nicho' ? null : 'nicho')}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border bg-white transition-colors ${
                    openDropdown === 'nicho' ? 'border-[#EF27FF]' : 'border-[#e0e0e0] hover:border-[#EF27FF]'
                  }`}
                >
                  <span className={selectedNicho ? 'text-[#1a1a1a]' : 'text-[#999999]'}>
                    {selectedNicho?.label ?? 'Selecione o nicho'}
                  </span>
                  <ChevronIcon open={openDropdown === 'nicho'} />
                </button>
                {openDropdown === 'nicho' && (
                  <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-[#e0e0e0] rounded-lg shadow-lg overflow-hidden">
                    {nichoOptions.map(o => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => { setForm(f => ({ ...f, nicho: o.value })); setOpenDropdown(null); }}
                        className={`w-full text-left px-3 py-2.5 text-sm border-b border-[#f4f4f4] last:border-0 transition-colors ${
                          form.nicho === o.value ? 'bg-[#1a1a1a] text-white' : 'text-[#333333] hover:bg-[#fdf0ff]'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-1 border-t border-[#f0f0f0]">
              <p className="text-xs text-[#999999] mb-4">
                Formato fixo: Reels · até 1 minuto
              </p>
              <button
                type="submit"
                disabled={isWorking}
                className="w-full bg-[#1a1a1a] text-white rounded-lg py-3 text-sm font-semibold hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isFetchingRef ? 'Buscando referência...' : isLoading ? 'Gerando briefing...' : 'Buscar referência e adaptar'}
              </button>
            </div>
          </form>
        </aside>

        {/* Output */}
        <main className="flex-1 flex flex-col gap-3">
          <div className="bg-white rounded-xl border border-[#e0e0e0] p-6 min-h-[500px] flex flex-col">

            {/* Web-search brand profile fallback warning — shown above everything else */}
            {brandProfile?.perfil_via_busca_web && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
                {brandProfile.perfil_do_cache
                  ? `⚠️ Marca não cadastrada no perfil interno — usando perfil buscado automaticamente na web em ${brandProfile.perfil_cache_data}. Revise com cuidado, especialmente regras de conteúdo específicas da marca.`
                  : '⚠️ Marca não cadastrada no perfil interno — informações buscadas automaticamente na web. Revise com cuidado antes de aprovar, especialmente regras de conteúdo específicas da marca (o que pode ou não pode ser dito/mostrado), que não foram capturadas por essa busca.'}
              </p>
            )}

            {/* Reference card — shown above script */}
            {refAd?.found && (
              <div className="mb-5 border border-[#e0e0e0] rounded-lg p-4 bg-[#f4f4f4]">
                <p className="text-xs font-semibold text-[#666666] uppercase tracking-wider mb-2">
                  Referência usada
                </p>
                {refAd.nicho_divergente && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
                    ⚠️ Nenhum Long-Runner encontrado para o nicho {form.nicho} — esta referência é do nicho {refAd.nicho}
                  </p>
                )}
                <p className="text-sm font-semibold text-[#1a1a1a]">
                  {refAd.competitor} — {refAd.daysActive} dias ativo
                </p>
                <p className="text-sm text-[#666666] mb-1">Ângulo: {refAd.angleCategory}</p>
                <p className="text-sm text-[#666666] mb-3">Nicho: {refAd.nicho}</p>
                <a
                  href={refAd.adLibraryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm border border-[#EF27FF] text-[#EF27FF] rounded-lg px-4 py-2 hover:bg-[#fdf0ff] transition-colors"
                >
                  Ver anúncio no Ad Library
                </a>
              </div>
            )}

            {!refAd?.found && refAd !== null && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
                ⚠️ Nenhum anúncio de referência encontrado — o roteiro abaixo foi criado do zero, sem seguir a lógica de fidelidade à transcrição original.
              </p>
            )}

            {/* Empty state */}
            {!hasOutput && !isWorking && !refAd && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#666666] text-center">
                  Preencha o formulário ao lado<br />e clique em &ldquo;Buscar referência e adaptar&rdquo;
                </p>
              </div>
            )}

            {/* Loading state */}
            {isWorking && !hasOutput && (
              <div className="flex items-center gap-2 text-sm text-[#666666]">
                <span className="inline-block w-2 h-2 bg-[#EF27FF] rounded-full animate-pulse" />
                {isFetchingRef ? 'Buscando anúncio de referência...' : 'Gerando briefing...'}
              </div>
            )}

            {/* Briefing */}
            {hasOutput && (
              <div className="flex-1 flex flex-col gap-5">
                {/* Área exportada para o PDF — sem cards de referência, avisos ou botões */}
                <div ref={pdfRef} className="flex flex-col gap-5 bg-white">
                  {/* Metadados */}
                  <div className="pdf-avoid-break">
                    <div className="flex items-center gap-3 mb-3">
                      <img src="/logor5.png" alt="LPX" className="h-16 w-auto shrink-0" />
                      <h1 className="text-lg font-semibold text-[#1a1a1a]">{campanha}</h1>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-3">
                      <p><span className="font-medium text-[#1a1a1a]">Data de postagem:</span> <span className="text-[#666666]">{dataPostagem}</span></p>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#1a1a1a]">Escopo de entrega:</span>
                        <EscopoBadge text={escopoEntrega} />
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-[#1a1a1a] text-sm mb-1">Objetivo</p>
                      <AutoTextarea
                        value={displayed.objetivo}
                        onChange={updateField('objetivo')}
                        className="text-sm text-[#333333] leading-relaxed"
                      />
                    </div>
                  </div>

                  {/* Roteiro */}
                  <div className="grid gap-3">
                    {([
                      ['Hook', 'hook', object?.hook],
                      ['Corpo', 'corpo', object?.corpo],
                      ['CTA', 'cta', object?.cta],
                    ] as const).map(([label, key, streamed]) => (
                      streamed !== undefined && (
                        <div key={label} className="border border-[#e0e0e0] rounded-lg p-4 pdf-avoid-break">
                          <p className="text-xs font-semibold text-[#EF27FF] uppercase tracking-wider mb-2">{label}</p>
                          <AutoTextarea
                            value={displayed[key]}
                            onChange={updateField(key)}
                            className="text-sm text-[#1a1a1a] leading-relaxed"
                          />
                        </div>
                      )
                    ))}
                  </div>

                  {/* Dicas que valem ouro */}
                  {displayed.dicas.length > 0 && (
                    <div className="border-t border-[#e0e0e0] pt-4 pdf-avoid-break">
                      <p className="text-xs font-semibold text-[#666666] uppercase tracking-wider mb-2">
                        Dicas que valem ouro
                      </p>
                      <ul className="space-y-1">
                        {displayed.dicas.map((dica, i) => (
                          <li key={i} className="flex gap-2 text-sm text-[#333333]">
                            <span className="select-none">•</span>
                            <AutoTextarea
                              value={dica}
                              onChange={updateDica(i)}
                              className="flex-1 text-sm text-[#333333] leading-relaxed"
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {refAd?.found && refAd.videoUrl && !isLoading && (
                  <div className="pt-5 border-t border-[#e0e0e0]">
                    <p className="text-xs font-semibold text-[#666666] uppercase tracking-wider mb-2">
                      Vídeo de referência
                    </p>
                    <a
                      href={refAd.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-sm border border-[#EF27FF] text-[#EF27FF] rounded-lg px-4 py-2 hover:bg-[#fdf0ff] transition-colors"
                    >
                      Assistir ao anúncio original que inspirou este roteiro →
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {hasOutput && !isLoading && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                {notionStatus === 'saved' && (
                  <span className="text-green-600 font-medium">Salvo no Notion ✓</span>
                )}
                {notionStatus === 'error' && (
                  <span className="text-red-500">{notionError}</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="text-sm border border-[#e0e0e0] rounded-lg px-4 py-2 text-[#666666] hover:text-[#1a1a1a] hover:border-[#EF27FF] transition-colors"
                >
                  {copied ? 'Copiado!' : 'Copiar briefing'}
                </button>
                <button
                  onClick={handleDownloadPdf}
                  disabled={isDownloadingPdf}
                  className="text-sm border border-[#e0e0e0] rounded-lg px-4 py-2 text-[#666666] hover:text-[#1a1a1a] hover:border-[#EF27FF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isDownloadingPdf ? 'Gerando PDF...' : 'Baixar PDF'}
                </button>
                <button
                  onClick={handleSaveNotion}
                  disabled={notionStatus === 'saving'}
                  className="flex items-center gap-2 text-sm bg-[#1a1a1a] text-white rounded-lg px-4 py-2 hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {notionStatus === 'saving' ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : 'Salvar no Notion'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
