import { settings } from './store';
import type { SessionRecord } from './sessions';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export type SummaryInput = {
  hostNickname: string;
  hostUniqueId: string;
  roomTitle: string;
  durationMin: number;
  totals: SessionRecord['totals'];
  comments: { user: string; text: string }[];
  gifts: { user: string; gift: string; count: number; diamonds: number }[];
  questions: { user: string; text: string }[];
};

function packTranscript(input: SummaryInput): string {
  const lines: string[] = [];
  lines.push(`Host: ${input.hostNickname} (@${input.hostUniqueId})`);
  if (input.roomTitle) lines.push(`Room title: ${input.roomTitle}`);
  lines.push(`Duration: ${input.durationMin} minutes`);
  lines.push(
    `Totals — likes: ${input.totals.likes}, diamonds: ${input.totals.diamonds}, comments: ${input.totals.comments}, gifts: ${input.totals.gifts}, follows: ${input.totals.follows}, subs: ${input.totals.subs}, peak viewers: ${input.totals.peakViewers}`,
  );
  if (input.comments.length) {
    lines.push('', 'Comments (chronological):');
    for (const c of input.comments) lines.push(`- ${c.user}: ${c.text}`);
  }
  if (input.gifts.length) {
    lines.push('', 'Notable gifts:');
    for (const g of input.gifts)
      lines.push(`- ${g.user}: ${g.gift} ×${g.count} (${g.diamonds} diamonds)`);
  }
  if (input.questions.length) {
    lines.push('', 'Q&A questions:');
    for (const q of input.questions) lines.push(`- ${q.user}: ${q.text}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are summarizing a TikTok Live session for the broadcaster. Produce a concise, useful debrief in markdown with these sections:

## Vibes
One paragraph capturing the overall mood, energy, and audience tone.

## Hot topics
3–6 bullets of what people were actually talking about, with representative quotes where useful.

## Standouts
Notable participants — top gifters, frequent commenters, anyone who asked sharp questions or got pushback.

## Questions worth answering
Any Q&A items the host should follow up on, ranked by how much engagement they got.

## Risk / moderation flags
Anything off-color, harassing, spam-like, or worth a heads up. Empty section is fine if nothing notable.

## Suggestions for next stream
2–4 concrete ideas based on what the audience responded to.

Be specific. Quote real comments. No filler. If a section has nothing meaningful, write "Nothing notable." rather than padding.`;

export async function summarize(input: SummaryInput): Promise<string> {
  const apiKey = settings.get('anthropicApiKey', '');
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Add one in Settings.');
  }

  const body = {
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: packTranscript(input),
      },
    ],
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const block = (json?.content ?? []).find((b: any) => b.type === 'text');
  return block?.text ?? '(empty response)';
}
