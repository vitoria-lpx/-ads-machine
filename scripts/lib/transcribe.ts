import fs from 'node:fs';
import path from 'node:path';

export interface TranscriptionResult {
  text: string;
  duration: number;
}

/**
 * Mesmo endpoint/modelo usado pelo skill /ad-analyzer (.claude/commands/ad-analyzer.md, Step 2b):
 * Groq Whisper (whisper-large-v3-turbo), aceita .mp4 direto, sem precisar extrair áudio.
 */
export async function transcribeGroq(filePath: string): Promise<TranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada no .env');

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'pt');
  form.append('response_format', 'verbose_json');
  form.append('file', new Blob([buffer]), path.basename(filePath));

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
}

export async function downloadToTemp(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}
