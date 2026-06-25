import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/system-prompt';

export async function POST(req: Request) {
  const body = await req.json();

  const result = await streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(body) }],
  });

  return result.toTextStreamResponse();
}
