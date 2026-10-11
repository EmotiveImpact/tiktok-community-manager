import { useEffect, useMemo, useState } from 'react';
import { PanelHeader, PanelShell } from './PanelHeader';
import { useStore } from '../state/store';
import {
  buildTimeline, createEvidenceReport, nearbyChat,
  normaliseHandle, reportMarkdown, searchEvidence,
  type EvidenceKind,
} from '../lib/livelens/engine';

/**
 * LiveLens pilot view. Reuses the existing LIVE connector event feed:
 *  - chat names come from the chat event itself
 *  - captions are explicitly UNATTRIBUTED until an operator annotates them
 *  - report exports preserve evidence IDs and original timestamps
 * No automatic transcription, recording or cross-room identity tracking is claimed.
 */
export function LiveLensPanel({ onClose }: { onClose: () => void }) {
  const comments = useStore((s) => s.comments);
  const captions = useStore((s) => s.captions);
  const roomInfo = useStore((s) => s.roomInfo);
  const connectedUsername = useStore((s) => s.username);
  const status = useStore((s) => s.status);
  const room = normaliseHandle(roomInfo?.hostUniqueId || connectedUsername || 'unknown');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | EvidenceKind>('all');
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [archive, setArchive] = useState<{ state: string; error?: string }>({ state: 'unavailable' });
  const [archiveSession, setArchiveSession] = useState('');
  const [retained, setRetained] = useState<{ id: string; roomTitle: string }[]>([]);
  useEffect(() => { if (window.tiktok.livelensArchive) window.tiktok.sessionsList().then(setRetained).catch(() => setRetained([])); }, [status]);
  useEffect(() => { let live = true; window.tiktok.livelensArchiveStatus?.(archiveSession || undefined).then(s => live && setArchive(s)); return () => { live = false; }; }, [archiveSession]);

  const rows = useMemo(
    () => buildTimeline(room, comments, captions, {
      captionOffsetMs: offsetSeconds * 1000,
      manualCaptionAttribution: manual,
    }),
    [room, comments, captions, offsetSeconds, manual],
  );
  const shown = useMemo(() => searchEvidence(rows, query, kind), [rows, query, kind]);
  const selected = rows.find((r) => r.id === selectedId) ?? shown[shown.length - 1] ?? null;
  const surrounding = useMemo(
    () => selected?.kind === 'caption' ? nearbyChat(rows, selected.id) : [],
    [rows, selected?.id, selected?.kind],
  );

  useEffect(() => {
    setEditor(selected && selected.kind === 'caption' ? manual[selected.id] ?? '' : '');
  }, [selected?.id, selected?.kind, manual]);

  function download(content: string, mime: string, extension: string) {
    const filename = 'livelens-' + room.replace(/[^a-z0-9_-]/g, '') + '-' +
      new Date().toISOString().slice(0, 10) + '.' + extension;
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportReport(format: 'md' | 'json') {
    const report = createEvidenceReport(room, roomInfo?.title ?? '', rows);
    if (format === 'json') download(JSON.stringify(report, null, 2), 'application/json', 'json');
    else download(reportMarkdown(report), 'text/markdown', 'md');
  }

  const time = (ts: number) => new Date(ts).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <PanelShell>
      <PanelHeader
        title="LiveLens"
        subtitle="Conversation evidence"
        badge={rows.length}
        onClose={onClose}
        actions={
          <>
            <button
              onClick={() => exportReport('json')}
              disabled={!rows.length}
              className="panel-btn panel-btn-secondary"
              title="Export source-linked event JSON"
            >Export JSON</button>
            <button
              onClick={() => exportReport('md')}
              disabled={!rows.length}
              className="panel-btn panel-btn-primary"
              title="Export evidence report"
            >Export report</button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-700 px-4 py-3">
        <label className="text-xs text-zinc-300">Desktop archive
          <select aria-label="Desktop session to archive" value={archiveSession} onChange={e => setArchiveSession(e.target.value)} className="ml-2 rounded bg-zinc-800 p-2">
            <option value="">Current broadcast</option>{retained.map(s => <option key={s.id} value={s.id}>{s.roomTitle || s.id}</option>)}
          </select>
        </label>
        <button className="panel-btn" disabled={!window.tiktok.livelensArchive || (archive.state === 'pending' && !archive.error)} onClick={async () => { setArchive({ state: 'pending' }); try { setArchive(await window.tiktok.livelensArchive!(archiveSession || undefined)); } catch { setArchive({ state: 'failed', error: 'Upload failed; retry explicitly' }); } }}>Archive to LiveLens</button>
        <span role="status" className="text-xs text-zinc-400">{window.tiktok.livelensArchive ? archive.state : 'Browser demo — desktop archiving unavailable'}{archive.error && ` · ${archive.error}`}</span>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-zinc-800/60 px-4 py-3">
        <div className="mr-auto">
          <div className="text-sm font-semibold text-zinc-100">Listening context: @{room}</div>
          <div className="text-xs text-zinc-500">
            {status === 'connected' ? 'LIVE event stream connected' : 'Not connected to a LIVE'}
            {' · '}{rows.filter((r) => r.kind === 'chat').length} comments
            {' · '}{rows.filter((r) => r.kind === 'caption').length} captions
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Caption offset
          <input
            type="number" min={-30} max={30} step={1}
            value={offsetSeconds}
            onChange={(e) => {
              const next = Number(e.target.value);
              setOffsetSeconds(Number.isFinite(next) ? Math.max(-30, Math.min(30, next)) : 0);
            }}
            className="h-8 w-14 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-zinc-100"
            aria-label="Caption offset in seconds"
          />
          seconds
        </label>
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-zinc-800/60 px-4 py-2">
        {(['all', 'chat', 'caption'] as const).map((choice) => (
          <button
            key={choice}
            onClick={() => setKind(choice)}
            className={'rounded-md px-3 py-1.5 text-xs font-semibold ' +
              (kind === choice ? 'bg-pink-500/20 text-pink-300' : 'bg-zinc-900 text-zinc-400 hover:text-white')}
          >{choice === 'all' ? 'All evidence' : choice === 'chat' ? 'Chat' : 'Spoken captions'}</button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search words or usernames"
          className="ml-auto h-8 w-56 max-w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 outline-none focus:border-pink-500/70"
          aria-label="Search captured evidence"
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto p-3" aria-label="Conversation timeline">
          {!shown.length ? (
            <div className="mx-auto max-w-md py-20 text-center">
              <div className="text-sm font-semibold text-zinc-200">
                {rows.length ? 'No matching evidence' : 'No events captured'}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {rows.length
                  ? 'Try a broader search.'
                  : 'Connect to a LIVE to receive chat and TikTok captions. Captions require the broadcaster to enable them. Independent audio transcription is a later milestone.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {[...shown].reverse().map((row) => (
                <li key={row.id}>
                  <button
                    onClick={() => setSelectedId(row.id)}
                    className={'w-full rounded-lg border p-3 text-left transition ' +
                      (selected?.id === row.id
                        ? 'border-pink-500/50 bg-pink-500/10'
                        : 'border-zinc-800/70 bg-zinc-900/40 hover:border-zinc-600')}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono text-zinc-500">{time(row.ts)}</span>
                      <span className={'rounded px-1.5 py-0.5 ' +
                        (row.kind === 'chat' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/15 text-violet-300')}
                      >{row.kind === 'chat' ? 'Chat' : 'Caption'}</span>
                      <span className="font-semibold text-zinc-200">
                        {row.username ? '@' + row.username : 'Speaker unknown'}
                      </span>
                      {row.attribution === 'operator' && <span className="text-amber-400">(manual)</span>}
                    </div>
                    <p className="mt-2 break-words text-sm leading-5 text-zinc-200">{row.text}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="hidden w-72 flex-none overflow-y-auto border-l border-zinc-800/70 p-4 xl:block" aria-label="Evidence inspector">
          <h3 className="text-sm font-semibold text-zinc-100">Evidence inspector</h3>
          {!selected ? (
            <p className="mt-4 text-xs leading-5 text-zinc-500">Select a chat message or caption to inspect its source.</p>
          ) : (
            <div className="mt-4 space-y-4 text-xs text-zinc-400">
              <div>
                <div className="text-zinc-500">Source</div>
                <div className="mt-1 text-zinc-200">{selected.source}</div>
              </div>
              <div>
                <div className="text-zinc-500">Provider timestamp</div>
                <div className="mt-1 font-mono text-zinc-200">{selected.sourceTimestampMs == null ? 'Unavailable' : new Date(selected.sourceTimestampMs).toISOString()}</div>
                <div className="mt-2 text-zinc-500">Collector timestamp</div>
                <div className="mt-1 font-mono text-zinc-200">{new Date(selected.capturedAtMs).toISOString()}</div>
              </div>
              <div>
                <div className="text-zinc-500">Evidence ID</div>
                <div className="mt-1 break-all font-mono text-[10px] text-zinc-300">{selected.id}</div>
              </div>
              {selected.kind === 'caption' && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <label htmlFor="livelens-attribution" className="text-xs font-semibold text-zinc-200">
                    Manual speaker attribution
                  </label>
                  <p className="my-2 leading-4 text-zinc-500">
                    Assign a username only if you can independently establish who spoke.
                  </p>
                  <input
                    id="livelens-attribution"
                    value={editor}
                    onChange={(e) => setEditor(e.target.value)}
                    placeholder="@username or leave blank"
                    className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100"
                  />
                  <button
                    onClick={() => setManual((prev) => ({ ...prev, [selected.id]: editor }))}
                    className="panel-btn panel-btn-secondary mt-2"
                  >Apply to this caption</button>
                  <p className="mt-2 text-[10px] leading-4 text-zinc-500">
                    Pilot only: edits are stored in the current view, not permanently saved.
                  </p>
                </div>
              )}
              {selected.kind === 'caption' && (
                <div>
                  <div className="font-semibold text-zinc-200">Nearby preceding chat</div>
                  <div className="my-1 text-zinc-500">Time proximity only, not a confirmed reply.</div>
                  {surrounding.length === 0
                    ? <p className="mt-2 text-zinc-500">No chat within 45 seconds.</p>
                    : <ul className="mt-2 space-y-2">
                      {surrounding.slice(-8).map((chat) => (
                        <li key={chat.id} className="rounded border border-zinc-800 p-2">
                          <span className="font-medium text-sky-300">@{chat.username}</span>{' '}
                          <span className="text-zinc-300">{chat.text}</span>
                        </li>
                      ))}
                    </ul>}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <div className="flex-none border-t border-zinc-800/60 px-4 py-2 text-[11px] text-zinc-500">
        Source-linked pilot: captions are not independent transcription. Speech attribution and reports require review.
      </div>
    </PanelShell>
  );
}
