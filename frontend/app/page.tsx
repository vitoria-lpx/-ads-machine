'use client';

import { useCompletion } from '@ai-sdk/react';
import { useState } from 'react';

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

export default function Home() {
  const [form, setForm] = useState({ marca: '', produto: '', nicho: '' });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notionStatus, setNotionStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notionError, setNotionError] = useState('');
  const [refAd, setRefAd] = useState<RefAd | null>(null);
  const [isFetchingRef, setIsFetchingRef] = useState(false);

  const { completion, complete, isLoading } = useCompletion({
    api: '/api/generate',
    streamProtocol: 'text',
  });

  const isWorking = isFetchingRef || isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.marca || !form.produto || !form.nicho) return;
    setRefAd(null);
    setIsFetchingRef(true);

    let refAdData: RefAd = { found: false };
    try {
      const res = await fetch('/api/reference-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicho: form.nicho }),
      });
      refAdData = await res.json();
      setRefAd(refAdData);
    } catch {
      refAdData = { found: false };
    } finally {
      setIsFetchingRef(false);
    }

    complete('', {
      body: {
        marca:   form.marca,
        produto: form.produto,
        nicho:   form.nicho,
        refAd:   refAdData.found ? refAdData : null,
      },
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
          briefing: completion,
          marca:    form.marca,
          produto:  form.produto,
          nicho:    form.nicho,
          angulo:      refAd?.found ? refAd.angleCategory : '',
          formato:     'Reels',
          duracao:     '45s',
          adLibraryUrl: refAd?.found ? refAd.adLibraryUrl : '',
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
    navigator.clipboard.writeText(completion);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
                Formato fixo: Reels · 45s
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

            {/* Empty state */}
            {!completion && !isWorking && !refAd && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#666666] text-center">
                  Preencha o formulário ao lado<br />e clique em "Buscar referência e adaptar"
                </p>
              </div>
            )}

            {/* Loading state */}
            {isWorking && !completion && (
              <div className="flex items-center gap-2 text-sm text-[#666666]">
                <span className="inline-block w-2 h-2 bg-[#EF27FF] rounded-full animate-pulse" />
                {isFetchingRef ? 'Buscando anúncio de referência...' : 'Gerando briefing...'}
              </div>
            )}

            {/* Script */}
            {completion && (
              <>
                <pre className="whitespace-pre-wrap font-sans text-sm text-[#1a1a1a] leading-relaxed flex-1">
                  {completion}
                  {isLoading && <span className="animate-pulse text-[#EF27FF]">▊</span>}
                </pre>

                {refAd?.found && refAd.videoUrl && !isLoading && (
                  <div className="mt-6 pt-5 border-t border-[#e0e0e0]">
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
              </>
            )}
          </div>

          {completion && !isLoading && (
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
