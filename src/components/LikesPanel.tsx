import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatNumber } from '../lib/format';

export function LikesPanel() {
  const totalLikes = useStore((s) => s.totalLikes);
  const tpsFn = useStore((s) => s.tps);
  const [tps, setTps] = useState(0);
  const heartRef = useRef<HTMLDivElement | null>(null);
  const lastCount = useRef(totalLikes);

  useEffect(() => {
    const t = setInterval(() => setTps(tpsFn()), 250);
    return () => clearInterval(t);
  }, [tpsFn]);

  useEffect(() => {
    if (totalLikes !== lastCount.current && heartRef.current) {
      heartRef.current.classList.remove('pop');
      void heartRef.current.offsetWidth;
      heartRef.current.classList.add('pop');
      lastCount.current = totalLikes;
    }
  }, [totalLikes]);

  const perMin = Math.round(tps * 60);

  return (
    <div className="glass flex flex-none items-center gap-4 overflow-hidden rounded-xl bg-gradient-to-br from-like-500/8 to-transparent px-4 py-4">
      <div className="flex flex-1 flex-col">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-like-400">Total Likes</div>
        <div ref={heartRef} className="text-[34px] font-extrabold leading-none tabular-nums text-like-400" style={{ letterSpacing: '-1px' }}>
          {formatNumber(totalLikes)}
        </div>
        <div className="mt-1 text-[10px] text-zinc-500">+{formatNumber(perMin)} / min</div>
      </div>
      <div className="flex flex-none flex-col items-end">
        <div className="text-xl font-bold tabular-nums text-zinc-100">{tps.toFixed(1)}</div>
        <div className="text-[10px] text-zinc-500">likes / sec</div>
      </div>
    </div>
  );
}
