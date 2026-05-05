import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

const HISTORY_LEN = 60;
const TICK_MS = 5000;

export function EngagementScore() {
  const status = useStore((s) => s.status);
  const totalLikes = useStore((s) => s.totalLikes);
  const commentCount = useStore((s) => s.commentCount);
  const totalDiamonds = useStore((s) => s.totalDiamonds);
  const giftCount = useStore((s) => s.giftCount);
  const followCount = useStore((s) => s.followCount);
  const viewerCount = useStore((s) => s.viewerCount);

  const last = useRef({ totalLikes, commentCount, totalDiamonds, giftCount, followCount, viewerCount });
  const [history, setHistory] = useState<number[]>([]);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (status !== 'connected') {
      setHistory([]);
      setScore(0);
      last.current = { totalLikes: 0, commentCount: 0, totalDiamonds: 0, giftCount: 0, followCount: 0, viewerCount: 0 };
      return;
    }
    const t = setInterval(() => {
      const cur = useStore.getState();
      const dLikes = cur.totalLikes - last.current.totalLikes;
      const dComments = cur.commentCount - last.current.commentCount;
      const dDiamonds = cur.totalDiamonds - last.current.totalDiamonds;
      const dGifts = cur.giftCount - last.current.giftCount;
      const dFollows = cur.followCount - last.current.followCount;
      const dViewers = cur.viewerCount - last.current.viewerCount;
      last.current = {
        totalLikes: cur.totalLikes,
        commentCount: cur.commentCount,
        totalDiamonds: cur.totalDiamonds,
        giftCount: cur.giftCount,
        followCount: cur.followCount,
        viewerCount: cur.viewerCount,
      };
      const raw =
        dLikes * 0.5 +
        dComments * 4 +
        dDiamonds * 0.3 +
        dGifts * 6 +
        dFollows * 12 +
        Math.max(dViewers, 0) * 2;
      const newScore = Math.round(raw);
      setScore(newScore);
      setHistory((h) => [...h, newScore].slice(-HISTORY_LEN));
    }, TICK_MS);
    return () => clearInterval(t);
  }, [status]);

  const max = Math.max(...history, 1);
  const avg = history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  const tone = score > avg * 2 && score > 5 ? 'fire' : score > avg && score > 2 ? 'good' : 'flat';

  return (
    <div className="glass flex flex-none items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5">
      <div className="flex flex-col">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Engagement</div>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-lg font-bold tabular-nums ${
            tone === 'fire' ? 'text-like-400' : tone === 'good' ? 'text-emerald-300' : 'text-zinc-300'
          }`}>
            {score}
          </span>
          {tone === 'fire' && <span className="text-[10px] font-semibold text-like-400">🔥 hot</span>}
        </div>
      </div>
      <div className="flex flex-1 items-end justify-end gap-px" style={{ height: 28 }}>
        {Array.from({ length: HISTORY_LEN }).map((_, i) => {
          const v = history[i] ?? 0;
          const h = max > 0 ? Math.max((v / max) * 100, 2) : 2;
          const isLast = i === history.length - 1;
          return (
            <div
              key={i}
              className={`w-[3px] rounded-sm ${
                isLast
                  ? tone === 'fire' ? 'bg-like-500' : tone === 'good' ? 'bg-emerald-400' : 'bg-zinc-500'
                  : v > avg ? 'bg-zinc-500' : 'bg-zinc-700'
              }`}
              style={{ height: `${h}%`, opacity: i < HISTORY_LEN - history.length ? 0 : 1 }}
            />
          );
        })}
      </div>
    </div>
  );
}
