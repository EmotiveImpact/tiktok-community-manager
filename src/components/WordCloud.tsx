import { useMemo } from 'react';
import { useStore } from '../state/store';
import { PanelHeader, PanelShell } from './PanelHeader';
import { Tooltip } from './ui';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'to', 'in', 'for', 'of', 'and', 'or', 'on', 'at', 'by',
  'i', 'me', 'my', 'we', 'you', 'he', 'she', 'they', 'this', 'that', 'was', 'are', 'be',
  'has', 'had', 'do', 'did', 'will', 'can', 'so', 'no', 'not', 'but', 'if', 'up', 'out',
  'just', 'like', 'with', 'what', 'from', 'have', 'been', 'its', 'your', 'all', 'im', 'lol',
  'get', 'got', 'how', 'who', 'why', 'where', 'when', 'am', 'as', 'than', 'them', 'their',
  'his', 'her', 'our', 'us', 'would', 'could', 'should', 'about', 'more', 'some', 'very',
  'too', 'also', 'dont', 'doesnt', 'wont', 'cant', 'thats', 'there', 'here', 'then',
]);

const COLORS = [
  'text-like-400', 'text-amber-300', 'text-emerald-300', 'text-cyan-400',
  'text-purple-400', 'text-rose-400', 'text-cyan-300', 'text-orange-400',
];

const BAR_COLORS = ['bg-like-500', 'bg-cyan-400', 'bg-purple-400', 'bg-amber-300', 'bg-emerald-400'];

type WordEntry = { word: string; count: number; size: string; weight: string; color: string };

export function WordCloud({ onClose }: { onClose: () => void }) {
  const comments = useStore((s) => s.comments);

  const words = useMemo(() => {
    const freq = new Map<string, number>();
    for (const c of comments) {
      if (c.type !== 'chat') continue;
      const text = (c as any).comment as string;
      if (!text) continue;
      const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      for (const w of tokens) {
        if (w.length < 2 || STOP_WORDS.has(w)) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }

    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
    if (sorted.length === 0) return [];

    const maxCount = sorted[0][1];
    const minCount = sorted[sorted.length - 1][1];
    const range = Math.max(maxCount - minCount, 1);

    return sorted.map(([word, count], i): WordEntry => {
      const norm = (count - minCount) / range;
      const size = norm > 0.8 ? 'text-4xl' : norm > 0.6 ? 'text-3xl' : norm > 0.4 ? 'text-2xl' : norm > 0.2 ? 'text-xl' : norm > 0.1 ? 'text-lg' : 'text-sm';
      const weight = norm > 0.5 ? 'font-extrabold' : norm > 0.2 ? 'font-bold' : 'font-semibold';
      return { word, count, size, weight, color: COLORS[i % COLORS.length] };
    });
  }, [comments]);

  const trending = useMemo(() => words.slice(0, 5), [words]);
  const maxTrending = trending[0]?.count ?? 1;

  const topicTimelines = useMemo(() => {
    if (trending.length === 0 || comments.length === 0) return new Map<string, number[]>();
    const chats = comments.filter((c) => c.type === 'chat') as any[];
    if (chats.length === 0) return new Map<string, number[]>();
    const newest = chats[0].ts;
    const oldest = chats[chats.length - 1].ts;
    const span = Math.max(newest - oldest, 60_000);
    const bins = 20;
    const map = new Map<string, number[]>();
    for (const w of trending) {
      const buckets = new Array(bins).fill(0);
      for (const c of chats) {
        const text = (c.comment as string ?? '').toLowerCase();
        if (!text.includes(w.word)) continue;
        const idx = Math.min(bins - 1, Math.floor(((c.ts - oldest) / span) * bins));
        buckets[idx]++;
      }
      map.set(w.word, buckets);
    }
    return map;
  }, [trending, comments]);

  const sentiment = useMemo(() => {
    const positive = ['love', 'amazing', 'great', 'awesome', 'beautiful', 'nice', 'good', 'best', 'thank', 'thanks', 'fire', 'goat', 'king', 'queen', 'legend', 'cute', 'perfect', 'wow', 'yay', 'yes'];
    const negative = ['hate', 'bad', 'ugly', 'worst', 'boring', 'cringe', 'gross', 'fake', 'scam', 'trash', 'stop', 'leave', 'no', 'ugh', 'sucks'];

    let pos = 0, neg = 0, total = 0;
    for (const c of comments) {
      if (c.type !== 'chat') continue;
      const text = ((c as any).comment as string ?? '').toLowerCase();
      total++;
      for (const w of positive) if (text.includes(w)) { pos++; break; }
      for (const w of negative) if (text.includes(w)) { neg++; break; }
    }
    const neutral = total - pos - neg;
    return { pos, neg, neutral, total };
  }, [comments]);

  const posPct = sentiment.total ? Math.round((sentiment.pos / sentiment.total) * 100) : 0;
  const negPct = sentiment.total ? Math.round((sentiment.neg / sentiment.total) * 100) : 0;
  const neutPct = Math.max(0, 100 - posPct - negPct);

  return (
    <PanelShell>
      <PanelHeader title="Chat Insights" badge={comments.length} onClose={onClose} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <section className="glass rounded-xl p-5">
              <div className="mb-4 text-sm font-semibold text-zinc-100">Sentiment Analysis</div>
              {sentiment.total === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-600">No messages yet</div>
              ) : (
                <>
                  <div className="mb-3 flex h-8 gap-1 overflow-hidden rounded-lg">
                    {posPct > 0 && (
                      <div
                        className="flex items-center bg-gradient-to-r from-emerald-600 to-emerald-400 pl-2 text-xs font-bold text-white"
                        style={{ width: `${posPct}%` }}
                      >
                        {posPct >= 8 && `${posPct}%`}
                      </div>
                    )}
                    {neutPct > 0 && (
                      <div
                        className="flex items-center justify-center bg-zinc-700 text-xs font-bold text-zinc-300"
                        style={{ width: `${neutPct}%` }}
                      >
                        {neutPct >= 8 && `${neutPct}%`}
                      </div>
                    )}
                    {negPct > 0 && (
                      <div
                        className="flex items-center justify-center bg-gradient-to-r from-rose-400 to-rose-500 text-xs font-bold text-white"
                        style={{ width: `${negPct}%` }}
                      >
                        {negPct >= 8 && `${negPct}%`}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /><span className="text-zinc-400">Positive ({posPct}%)</span></div>
                    <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-zinc-600" /><span className="text-zinc-400">Neutral ({neutPct}%)</span></div>
                    <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-rose-400" /><span className="text-zinc-400">Negative ({negPct}%)</span></div>
                  </div>
                </>
              )}
            </section>

            <section className="glass rounded-xl p-5">
              <div className="mb-4 text-sm font-semibold text-zinc-100">Trending Topics</div>
              {trending.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-600">No words yet</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {trending.map((w, i) => {
                    const timeline = topicTimelines.get(w.word) ?? [];
                    const peak = Math.max(...timeline, 1);
                    return (
                      <div key={w.word} className="flex items-center gap-3">
                        <span className={`w-6 text-base font-bold ${i === 0 ? 'text-like-400' : 'text-zinc-500'}`}>#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-zinc-100">{w.word}</span>
                            <span className="flex-none text-[11px] text-zinc-500">{w.count}</span>
                          </div>
                          <div className="mt-1 flex items-end gap-px" style={{ height: 16 }}>
                            {timeline.map((v, j) => (
                              <div
                                key={j}
                                className={`flex-1 rounded-sm ${BAR_COLORS[i % BAR_COLORS.length]}`}
                                style={{ height: `${Math.max((v / peak) * 100, 6)}%`, opacity: v === 0 ? 0.15 : 0.85 }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="h-1.5 w-16 flex-none overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                            style={{ width: `${(w.count / maxTrending) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="glass flex min-h-[400px] flex-col rounded-xl p-5">
            <div className="mb-3 text-sm font-semibold text-zinc-100">Word Cloud</div>
            {words.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
                No chat messages yet. Connect to a live to see word trends.
              </div>
            ) : (
              <div className="flex flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-2 p-4">
                {words.map((w) => (
                  <Tooltip key={w.word} content={`${w.word}: ${w.count} uses`}>
                    <span
                      className={`${w.size} ${w.weight} ${w.color} cursor-default leading-none transition hover:opacity-70`}
                    >
                      {w.word}
                    </span>
                  </Tooltip>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </PanelShell>
  );
}
