---
name: comparar
description: Compara os vídeos de influencer na pasta do Drive de uma marca LPX contra os anúncios em vídeo ativos dessa marca no Meta Ad Library (via transcrição + similaridade de texto), pra flagar reuso de criativo como anúncio pago. Apresenta o resultado em lista com % de semelhança.
---

# Comparar Criativos (verificar-ads)

Você é a interface pro script `scripts/verificar-ads.ts`. Ele baixa os vídeos que influencers mandaram (pasta do Drive da marca), transcreve com Whisper, baixa os anúncios em vídeo **ativos** da marca no Meta Ad Library, transcreve também, e compara texto a texto pra achar reuso -- vídeo enviado por influencer rodando como anúncio pago, com ou sem contrato.

**O que você produz:** uma lista de todos os vídeos da pasta do Drive, ordenada por % de semelhança com o anúncio ativo mais parecido, destacando os que batem o threshold (rodando) e os "quase" que merecem uma checada manual.

---

## Config

Marcas cadastradas em `reference/marcas-lpx-ads.json`:
```json
{
  "NomeDaMarca": {
    "pageIds": ["..."],
    "driveFolder": "Nome da pasta no Drive (opcional se driveFolderId estiver setado)",
    "driveFolderId": "ID da pasta (prioridade sobre driveFolder, evita ambiguidade)"
  }
}
```

Threshold de match em `scripts/lib/compare.ts` (`MATCH_THRESHOLD`, hoje 0.8 / 80%).

---

## Step 1: Qual marca?

Se o usuário já disse a marca no comando (`/comparar Lumi`), use direto. Senão pergunte.

Leia `reference/marcas-lpx-ads.json` e confira:
- A marca existe no arquivo e tem `pageIds` preenchido? Se não tiver Page ID, avise e pare -- não dá pra buscar no Ad Library sem isso.
- Se não tiver `driveFolderId` nem `driveFolder`, a busca vai usar o nome da marca como nome da pasta -- funciona às vezes (ex: Hoomy), mas pode achar 0 vídeos por divergência de nome/maiúsculas (ex: Maite). Isso só se descobre rodando.

---

## Step 2: Rodar

```
npm run verificar-ads -- "{NomeDaMarca}"
```

Rode em background (pode levar minutos dependendo de quantos vídeos tem na pasta e quantos anúncios ativos a marca tem).

**Se a etapa 1 do output disser "0 vídeo(s) encontrado(s) na pasta"**: a busca por nome falhou. Peça ao usuário o link da pasta do Drive (`drive.google.com/drive/folders/{ID}`), extraia o `{ID}`, adicione como `driveFolderId` no registro da marca em `reference/marcas-lpx-ads.json`, e rode de novo.

---

## Step 3: Apresentar como lista

Parseie o bloco `=== Resumo — {marca} ===` da saída e monte uma tabela ordenada do maior para o menor % de semelhança:

```
| Vídeo | Similaridade | Status |
|---|---|---|
| {nome do arquivo} | **{pct}%** | 🚨 RODANDO → {libraryUrl} |
| {nome do arquivo} | {pct}% | não encontrado |
| {nome do arquivo} | — | sem áudio, não comparado |
```

- Marque com 🚨 e negrito qualquer linha que bateu o threshold ("RODANDO").
- Vídeos com nome contendo `*SEM CONTRATO*` são o caso de maior risco -- se um desses aparecer como RODANDO, chame atenção especial (é reuso sem autorização).
- Vídeos "não transcrito (sem áudio ou falha na transcrição)" -- normal pra clipes mudos/b-roll, não é bug do script. Liste como "sem áudio, não comparado".
- Cite quantos vídeos tinham na pasta vs. quantos anúncios ativos foram comparados (dá contexto pro tamanho da amostra).

---

## Step 4: Oferecer comparação manual dos "quase"

Depois da lista, se houver algum vídeo com % alto mas abaixo do threshold (ex: 60-79%) que pareça suspeito -- especialmente se for `*SEM CONTRATO*` -- ofereça puxar a transcrição completa dele e do anúncio mais parecido, pro usuário comparar com os próprios olhos (o algoritmo de similaridade de texto penaliza reescrita/reordenação de frases mesmo quando o conteúdo é essencialmente o mesmo roteiro).

Pra isso, **não precisa reprocessar a marca inteira**: escreva um script ad-hoc temporário na raiz do repo (nunca dentro de `scripts/`, pra não virar parte permanente do projeto) que:
1. usa `listVideosInFolder` + `downloadDriveFile` + `transcribeGroq` de `scripts/lib/drive.ts` e `scripts/lib/transcribe.ts` pra pegar a transcrição só do vídeo específico do Drive;
2. usa `fetchActiveVideoAds` de `scripts/lib/apify.ts` + `downloadToTemp` + `transcribeGroq` pra transcrever os anúncios ativos da marca;
3. usa `bestMatch` de `scripts/lib/compare.ts` pra achar o índice do mais parecido;
4. imprime as duas transcrições completas.

Rode com `npx tsx {arquivo}.ts`, mostre as duas transcrições pro usuário, e **apague o arquivo temporário depois** (`rm`).

---

## CRITICAL RULES

1. Nunca invente % de semelhança -- sempre vem do output real do script (`bestMatch` em `scripts/lib/compare.ts`).
2. Sempre rode o comando de verdade (não simule) -- os dados vêm ao vivo do Drive e do Meta Ad Library, mudam a cada execução.
3. Se o script falhar em transcrever algum vídeo por erro que não seja "sem áudio" (ex: 413, fetch failed, erro de rede), isso é uma falha real -- avise o usuário que aquele vídeo ficou de fora da comparação, não finja que foi comparado.
4. Apague qualquer script `.ts` temporário que você criar na raiz do repo depois de usar -- não deixa lixo no working tree.
5. Se `git status` mostrar mudanças não commitadas em `reference/marcas-lpx-ads.json` (novo `driveFolderId` adicionado nesta sessão), mencione ao usuário que a config foi salva, mas não faça commit sem ele pedir.
