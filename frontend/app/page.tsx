'use client';

import { useCompletion } from '@ai-sdk/react';
import { useState, useEffect, useRef } from 'react';

const ANGULOS = [
  { value: 'Pain-to-Solution',     label: 'Dor e solução — o produto resolve um problema real do público' },
  { value: 'Benefit/Result',       label: 'Benefício e resultado — o foco é no resultado que o produto entrega' },
  { value: 'Education',            label: 'Educação sobre o produto — explica como o produto funciona ou seus diferenciais' },
  { value: 'Lifestyle/Aspiration', label: 'Estilo de vida — o produto faz parte de uma rotina ou identidade desejada' },
  { value: 'Social Proof',         label: 'Prova social — depoimento ou experiência real de quem já usou' },
  { value: 'Offer/Urgency',        label: 'Oferta e urgência — destaca desconto, lançamento ou disponibilidade limitada' },
];

const FORMATOS = [
  'Pessoa falando para a câmera',
  'Uso do produto',
  'Antes e depois',
];

const NICHOS = ['Beleza', 'Moda', 'Wellness'];

const DORES: Record<string, string[]> = {
  Beleza: [
    'Pele com imperfeições, manchas ou acne',
    'Pele oleosa, poros dilatados ou brilho excessivo',
    'Cabelo danificado, ressecado ou sem vida',
  ],
  Moda: [
    'Dificuldade de montar looks versáteis',
    'Roupas que não servem bem ou caimento ruim',
    'Falta de peças práticas para o dia a dia',
  ],
  Wellness: [
    'Inchaço ou desconforto após as refeições',
    'Falta de energia ou cansaço no treino',
    'Dificuldade para manter uma rotina saudável',
  ],
};

const PUBLICACOES = ['Reels', 'Story'];

const CTA_DESTINOS = [
  { value: 'link-bio',     label: 'Link na bio' },
  { value: 'link-stories', label: 'Link nos stories' },
  { value: 'cupom',        label: 'Cupom MARCA10' },
];

const DURACOES = ['15s', '30s', '45s', '60s'];

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

export default function Home() {
  const [form, setForm] = useState({
    marca: '',
    produto: '',
    nicho: '',
    dor: '',
    dorCustom: '',
    angulo: '',
    formato: '',
    publicacao: '',
    duracao: '30s',
    ctaDestinoOpcao: '',
    ctaCupomNome: '',
    ctaUrgencia: '',
  });

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notionStatus, setNotionStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notionError, setNotionError] = useState('');

  type RefAd =
    | { found: true; competitor: string; adLibraryUrl: string; daysActive: number; angleCategory: string; fallback: boolean }
    | { found: false };
  const [refAd, setRefAd] = useState<RefAd | null>(null);
  const wasLoadingRef = useRef(false);

  const { completion, complete, isLoading } = useCompletion({
    api: '/api/generate',
    streamProtocol: 'text',
  });

  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && completion) {
      const anguloLabel = ANGULOS.find(a => a.value === form.angulo)?.label.split(' — ')[0] ?? form.angulo;
      fetch('/api/reference-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicho: form.nicho, angulo: anguloLabel }),
      })
        .then(r => r.json())
        .then(data => setRefAd(data))
        .catch(() => {});
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nicho || !form.dor || !form.angulo || !form.formato || !form.publicacao) return;
    setRefAd(null);

    const dorFinal = form.dor === 'outros' ? form.dorCustom : form.dor;
    const ctaDestinoTexto =
      form.ctaDestinoOpcao === 'link-bio'     ? 'link na bio' :
      form.ctaDestinoOpcao === 'link-stories' ? 'link nos stories' :
      form.ctaDestinoOpcao === 'cupom'        ? `cupom ${form.ctaCupomNome || 'MARCA10'}` : '';

    complete('', {
      body: {
        marca: form.marca,
        produto: form.produto,
        nicho: form.nicho,
        dor: dorFinal,
        angulo: form.angulo,
        formato: form.formato,
        publicacao: form.publicacao,
        duracao: form.duracao,
        ctaDestino: ctaDestinoTexto,
        ctaUrgencia: form.ctaUrgencia,
      },
    });
  };

  const handleSaveNotion = async () => {
    setNotionStatus('saving');
    setNotionError('');
    try {
      const anguloLabel = ANGULOS.find(a => a.value === form.angulo)?.label.split(' — ')[0] ?? form.angulo;
      const res = await fetch('/api/save-notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefing: completion,
          marca: form.marca,
          produto: form.produto,
          nicho: form.nicho,
          angulo: anguloLabel,
          formato: form.formato,
          duracao: form.duracao,
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

  const field = (label: string, key: keyof typeof form, placeholder: string, required = true, optional = false) => (
    <div>
      <label className="block text-sm font-medium text-[#1a1a1a] mb-1">
        {label}
        {optional && <span className="ml-1 text-[#666666] font-normal">(opcional)</span>}
      </label>
      <input
        type="text"
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        required={required}
        className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm input-lpx transition text-[#1a1a1a] placeholder:text-[#999999]"
      />
    </div>
  );

  const dropdown = (
    id: string,
    label: string,
    options: { value: string; label: string }[],
    selectedValue: string,
    placeholder: string,
    onSelect: (value: string) => void,
    disabled = false,
  ) => {
    const selected = options.find(o => o.value === selectedValue);
    return (
      <div>
        <label className="block text-sm font-medium text-[#1a1a1a] mb-2">{label}</label>
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpenDropdown(openDropdown === id ? null : id)}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border bg-white transition-colors ${
              disabled
                ? 'border-[#e0e0e0] opacity-40 cursor-not-allowed'
                : openDropdown === id
                  ? 'border-[#EF27FF]'
                  : 'border-[#e0e0e0] hover:border-[#EF27FF]'
            }`}
          >
            <span className={selected ? 'text-[#1a1a1a]' : 'text-[#999999]'}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronIcon open={openDropdown === id} />
          </button>
          {openDropdown === id && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-[#e0e0e0] rounded-lg shadow-lg overflow-hidden">
              {options.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onSelect(o.value); setOpenDropdown(null); }}
                  className={`w-full text-left px-3 py-2.5 text-sm border-b border-[#f4f4f4] last:border-0 transition-colors ${
                    selectedValue === o.value
                      ? 'bg-[#1a1a1a] text-white'
                      : 'text-[#333333] hover:bg-[#fdf0ff]'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const dorOptions = form.nicho
    ? [
        ...(DORES[form.nicho] ?? []).map(d => ({ value: d, label: d })),
        { value: 'outros', label: 'Outros:' },
      ]
    : [];

  const anguloOptions = ANGULOS.map(a => ({ value: a.value, label: a.label }));
  const formatoOptions = FORMATOS.map(f => ({ value: f, label: f }));
  const publicacaoOptions = PUBLICACOES.map(p => ({ value: p, label: p }));

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
        <aside className="w-full lg:w-[380px] shrink-0">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[#e0e0e0] p-6 space-y-5">
            <h2 className="text-sm font-semibold text-[#1a1a1a] uppercase tracking-wider">Inputs</h2>

            {field('Marca', 'marca', 'Ex: LUMI, BB Cream, Hoomy')}
            {field('Produto', 'produto', 'Ex: suplemento em pó para digestão')}

            {/* Nicho */}
            {dropdown(
              'nicho', 'Nicho',
              NICHOS.map(n => ({ value: n, label: n })),
              form.nicho,
              'Selecione o nicho',
              (value) => setForm(f => ({ ...f, nicho: value, dor: '', dorCustom: '' })),
            )}

            {/* Dor do público */}
            <div>
              {dropdown(
                'dor', 'Dor do público',
                dorOptions,
                form.dor,
                form.nicho ? 'Selecione a dor' : 'Selecione o nicho primeiro',
                (value) => setForm(f => ({ ...f, dor: value, dorCustom: '' })),
                !form.nicho,
              )}
              {form.dor === 'outros' && (
                <input
                  type="text"
                  value={form.dorCustom}
                  onChange={e => setForm(f => ({ ...f, dorCustom: e.target.value }))}
                  placeholder="Descreva a dor do público..."
                  required
                  className="mt-2 w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm input-lpx transition text-[#1a1a1a] placeholder:text-[#999999]"
                />
              )}
            </div>

            {/* Ângulo */}
            {dropdown('angulo', 'Ângulo', anguloOptions, form.angulo, 'Selecione o ângulo',
              (value) => setForm(f => ({ ...f, angulo: value })))}

            {/* Formato */}
            {dropdown('formato', 'Formato', formatoOptions, form.formato, 'Selecione o formato',
              (value) => setForm(f => ({ ...f, formato: value })))}

            {/* Publicação */}
            {dropdown('publicacao', 'Publicação', publicacaoOptions, form.publicacao, 'Selecione a publicação',
              (value) => setForm(f => ({ ...f, publicacao: value })))}

            {/* Duração */}
            <div>
              <label className="block text-sm font-medium text-[#1a1a1a] mb-2">Duração</label>
              <div className="grid grid-cols-4 gap-2">
                {DURACOES.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, duracao: d }))}
                    className={`py-2 text-sm rounded-lg border font-medium transition-colors ${
                      form.duracao === d
                        ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                        : 'bg-white text-[#333333] border-[#e0e0e0] hover:bg-[#fdf0ff] hover:border-[#EF27FF]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="border-t border-[#e0e0e0] pt-5 space-y-4">
              <h3 className="text-xs font-semibold text-[#333333] uppercase tracking-wider">CTA</h3>

              {/* Destino */}
              {dropdown(
                'ctaDestino', 'Destino',
                CTA_DESTINOS,
                form.ctaDestinoOpcao,
                'Selecione o destino',
                (value) => setForm(f => ({ ...f, ctaDestinoOpcao: value, ctaCupomNome: '' })),
              )}
              {form.ctaDestinoOpcao === 'cupom' && (
                <input
                  type="text"
                  value={form.ctaCupomNome}
                  onChange={e => setForm(f => ({ ...f, ctaCupomNome: e.target.value }))}
                  placeholder="Ex: VITORIA10"
                  className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm input-lpx transition text-[#1a1a1a] placeholder:text-[#999999]"
                />
              )}

              {field('Urgência', 'ctaUrgencia', 'Ex: só até domingo, estoque limitado', false, true)}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#1a1a1a] text-white rounded-lg py-3 text-sm font-semibold hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Gerando briefing...' : 'Gerar Briefing'}
            </button>
          </form>
        </aside>

        {/* Output */}
        <main className="flex-1 flex flex-col gap-3">
          <div className="bg-white rounded-xl border border-[#e0e0e0] p-6 min-h-[500px] flex flex-col">
            {!completion && !isLoading && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#666666] text-center">
                  Preencha o formulário ao lado<br />e clique em Gerar Briefing
                </p>
              </div>
            )}

            {isLoading && !completion && (
              <div className="flex items-center gap-2 text-sm text-[#666666]">
                <span className="inline-block w-2 h-2 bg-[#EF27FF] rounded-full animate-pulse" />
                Gerando briefing...
              </div>
            )}

            {completion && (
              <pre className="whitespace-pre-wrap font-sans text-sm text-[#1a1a1a] leading-relaxed flex-1">
                {completion}
                {isLoading && <span className="animate-pulse text-[#EF27FF]">▊</span>}
              </pre>
            )}

            {refAd?.found && (
              <div className="mt-4 border border-[#e0e0e0] rounded-lg p-4 bg-[#f4f4f4]">
                <p className="text-xs font-semibold text-[#666666] uppercase tracking-wider mb-2">
                  📎 Vídeo de referência{refAd.fallback ? ' (nicho similar)' : ''}
                </p>
                <p className="text-sm font-semibold text-[#1a1a1a]">
                  {refAd.competitor} — Long-Runner ({refAd.daysActive} dias ativo)
                </p>
                <p className="text-sm text-[#666666] mb-3">Ângulo: {refAd.angleCategory}</p>
                <a
                  href={refAd.adLibraryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm border border-[#EF27FF] text-[#EF27FF] rounded-lg px-4 py-2 hover:bg-[#fdf0ff] transition-colors"
                >
                  Ver anúncio
                </a>
              </div>
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
