import { anthropic } from '@ai-sdk/anthropic';
import { streamText, createTextStreamResponse, toTextStream } from 'ai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/system-prompt';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    let marcasContent = '';
    try {
      marcasContent = readFileSync(join(process.cwd(), '..', 'reference', 'marcas-lpx.md'), 'utf-8');
    } catch {
      // proceed without brand profile if file not accessible
    }

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, marcasContent) }],
    });

    return createTextStreamResponse({
      stream: toTextStream({ stream: result.stream }),
    });
  } catch (error) {
    console.error('[generate] error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
