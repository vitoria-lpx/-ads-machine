import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/system-prompt';

export const runtime = 'edge';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const result = await streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body) }],
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('[generate] error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
