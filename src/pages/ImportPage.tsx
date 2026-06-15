/** Import — bring fans in from a CSV export (paste or file picker). */
import { useState } from 'react';
import type { ImportResult } from '../types';
import { useAlerts } from '../state/alerts';
import { PageShell, FieldLabel, inputCls } from '../components/crm';

const EXAMPLE = `username,displayName,birthday,tags,notes,totalDiamonds
kendraaax2,Kendra M.,07-24,superfan; mod-team,Loves the gaming streams,18420
mochi.eats,,12-01,foodie,Runs a food account,2840`;

const PLACEHOLDER = `e.g.\n${EXAMPLE}\n\n(paste your own export here, or use “Fill example”)`;

export function ImportPage({ onGoFollowers }: { onGoFollowers: () => void }) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [emptyHint, setEmptyHint] = useState(false);

  const run = async (fromFile: boolean) => {
    if (!fromFile && !text.trim()) {
      setEmptyHint(true);
      return;
    }
    setEmptyHint(false);
    setBusy(true);
    try {
      const r = fromFile ? await window.tiktok.fansImportCsvFile() : await window.tiktok.fansImportCsv(text);
      if (r.canceled) return;
      setResult(r);
      if (r.ok && r.created + r.updated > 0) {
        pushToast({ title: 'Import complete', body: `${r.created} created, ${r.updated} updated` });
      } else if (!r.ok) {
        pushToast({ title: 'Import failed', body: r.errors[0] ?? 'Unknown error' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Import" subtitle="Bring an existing follower list into the fan ledger from CSV.">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-stretch gap-4 lg:grid-cols-[1fr_320px]">
        <div className="glass p-4" style={{ borderRadius: 18 }}>
          <FieldLabel>Paste CSV (header row required)</FieldLabel>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); if (emptyHint) setEmptyHint(false); }}
            rows={12}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className={`${inputCls} csv-paste resize-y font-mono !text-[12px] leading-relaxed`}
          />
          <style>{`.csv-paste::placeholder { opacity: 0.38; font-style: italic; }`}</style>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => run(false)} disabled={busy} className="panel-btn panel-btn-primary no-drag">
              {busy ? 'Importing…' : 'Import pasted CSV'}
            </button>
            <button onClick={() => run(true)} disabled={busy} className="panel-btn no-drag">Choose CSV file…</button>
            <button onClick={() => setText(EXAMPLE)} className="panel-btn no-drag ml-auto">Fill example</button>
          </div>
          {emptyHint && (
            <p className="mt-2 text-[12px] font-semibold" style={{ color: 'var(--brand-pink, #EE1D52)' }}>
              Paste a CSV first, or tap “Fill example” to try it with sample data.
            </p>
          )}

          {result && (
            <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                <span><strong className="text-emerald-400">{result.created}</strong> created</span>
                <span><strong className="text-cyan-400">{result.updated}</strong> updated</span>
                <span><strong>{result.skipped}</strong> skipped</span>
                <span><strong className={result.errors.length ? 'text-rose-400' : ''}>{result.errors.length}</strong> errors</span>
                {result.ok && result.created + result.updated > 0 && (
                  <button onClick={onGoFollowers} className="ml-auto text-[12px] font-semibold hover:underline" style={{ color: 'var(--brand-pink)' }}>
                    View in Followers →
                  </button>
                )}
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-[12px] text-rose-400">
                  {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 20 && <li>…and {result.errors.length - 20} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <aside className="glass p-4 text-[13px]" style={{ borderRadius: 18 }}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <img src="./assets/png/icon_star_award_3d.png" alt="" className="h-6 w-6" draggable={false} />
            Expected columns
          </h3>
          <ul className="space-y-1.5" style={{ color: 'var(--secondary-label)' }}>
            <li><code className="font-semibold" style={{ color: 'var(--label, inherit)' }}>username</code> — required, with or without @</li>
            <li><code>displayName</code> — optional friendly name</li>
            <li><code>birthday</code> — optional, MM-DD or YYYY-MM-DD</li>
            <li><code>tags</code> — optional, separated by ; or |</li>
            <li><code>notes</code> — optional free text</li>
            <li><code>totalDiamonds</code> — optional, seeds the tier for new fans only (live gifts always win)</li>
          </ul>
          <p className="mt-3 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
            Existing fans are updated (tags merge, notes/birthday overwrite). Nothing is ever deleted by an import.
          </p>
        </aside>
      </div>
    </PageShell>
  );
}
