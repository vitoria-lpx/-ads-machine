import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

export interface TranscriptionResult {
  text: string;
  duration: number;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * Extrai só o áudio (mono, 16kHz, 32kbps) pra um mp3 temporário antes de mandar pro Whisper.
 * O Groq recusa arquivos acima de 25MB (413) -- vídeos de influencer (minutos, alta resolução)
 * estouram isso fácil, diferente dos clipes curtos de anúncio que o /ad-analyzer processa direto
 * como .mp4. Áudio comprimido de um vídeo de alguns minutos fica na casa de poucos MB.
 */
async function extractAudio(inputPath: string): Promise<string> {
  if (!ffmpegPath) throw new Error('ffmpeg-static não encontrou o binário do ffmpeg');
  const outPath = path.join(os.tmpdir(), `${path.basename(inputPath, path.extname(inputPath))}-${Date.now()}.mp3`);
  await execFileAsync(ffmpegPath, [
    '-y',
    '-i', inputPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '32k',
    outPath,
  ]);
  return outPath;
}

/**
 * Mesmo endpoint/modelo usado pelo skill /ad-analyzer (.claude/commands/ad-analyzer.md, Step 2b):
 * Groq Whisper (whisper-large-v3-turbo). Diferente do /ad-analyzer (manda .mp4 direto, clipes curtos
 * de anúncio), aqui extraímos o áudio primeiro porque os vídeos de influencer no Drive podem ser
 * grandes o bastante pra estourar o limite de 25MB do Groq.
 */
export async function transcribeGroq(filePath: string): Promise<TranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada no .env');

  const audioPath = await extractAudio(filePath);
  try {
    const buffer = fs.readFileSync(audioPath);
    return await withRetry(async () => {
      const form = new FormData();
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'pt');
      form.append('response_format', 'verbose_json');
      form.append('file', new Blob([buffer]), path.basename(audioPath));

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        throw new Error(`Groq transcription falhou (${res.status}): ${await res.text()}`);
      }

      const data = (await res.json()) as { text?: string; duration?: number };
      return { text: (data.text ?? '').trim(), duration: data.duration ?? 0 };
    });
  } finally {
    fs.unlinkSync(audioPath);
  }
}

export async function downloadToTemp(url: string, destPath: string): Promise<void> {
  await withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download falhou (${res.status}): ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  });
}
