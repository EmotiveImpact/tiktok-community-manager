import { useEffect, useRef, useState } from 'react';
import { ConnectBar } from './components/ConnectBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Followers } from './pages/Followers';
import { Gifts } from './pages/Gifts';
import { Reminders } from './pages/Reminders';
import { MessagesPage } from './pages/MessagesPage';
import { ImportPage } from './pages/ImportPage';
import { SettingsPage } from './pages/SettingsPage';
import { CommentFeed } from './components/CommentFeed';
import { GiftFeed } from './components/GiftFeed';
import { AllFeed } from './components/AllFeed';
import { TopContributors } from './components/TopContributors';
import { QuestionFeed } from './components/QuestionFeed';
import { UserDetailDrawer } from './components/UserDetailDrawer';
import { HistoryView } from './components/HistoryView';
import { StreamPlayer } from './components/StreamPlayer';
import { AllTimeLeaderboard } from './components/AllTimeLeaderboard';
import { AlertsPanel } from './components/AlertsPanel';
import { AlertToasts } from './components/AlertToasts';
import { WordCloud } from './components/WordCloud';
import { MultiRoom } from './components/MultiRoom';
import { ModerationPanel } from './components/ModerationPanel';
import { SessionComparison } from './components/SessionComparison';
import { CreatorAnalytics } from './components/CreatorAnalytics';
import { FollowerWatchlist } from './components/FollowerWatchlist';
import { TranscriptPanel } from './components/TranscriptPanel';
import { CommandPalette } from './components/CommandPalette';
import { HighlightsPanel } from './components/HighlightsPanel';
import { LikerPanel } from './components/LikerPanel';
import { FanNotesPanel } from './components/FanNotesPanel';
import { RoomMembersPanel } from './components/RoomMembersPanel';
import { TrackedUsersPanel } from './components/TrackedUsersPanel';
import { StatsStrip } from './components/StatsStrip';
import { EmptyState } from './components/EmptyState';
import { FanMemoryPanel } from './components/FanMemoryPanel';
import { NoteComposer } from './components/NoteComposer';
import { useStore } from './state/store';
import { useAlerts } from './state/alerts';
import { useTracked } from './state/tracked';
import { useUI, type FeedFilter, type LiveTool } from './state/ui';

function ToolbarBtn({ active, onClick, children, title, badge, badgeAccent }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string; badge?: number; badgeAccent?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag panel-btn ${active ? 'panel-btn-active' : ''}`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="panel-btn-badge" style={badgeAccent ? { background: 'var(--brand-pink)', color: 'white' } : undefined}>{badge}</span>
      )}
    </button>
  );
}

const TOOLS_GROUPS: { group: string; items: { id: LiveTool; label: string; icon: string }[] }[] = [
  {
    group: 'Audience',
    items: [
      { id: 'tracked', label: 'Tracked Users', icon: '★' },
      { id: 'notes', label: 'Fan Notes', icon: '📝' },
      { id: 'room', label: 'Room Members', icon: '👥' },
      { id: 'leaderboard', label: 'All-Time Leaderboard', icon: '🏆' },
      { id: 'watchlist', label: 'Go-Live Watchlist', icon: '👀' },
    ],
  },
  {
    group: 'Live',
    items: [
      { id: 'alerts', label: 'Alerts', icon: '🔔' },
      { id: 'mod', label: 'Moderation', icon: '🛡️' },
      { id: 'transcript', label: 'Live Transcript', icon: '🎙️' },
      { id: 'highlights', label: 'Highlight Clips', icon: '🎬' },
      { id: 'liker', label: 'Live Liker', icon: '❤️' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { id: 'insights', label: 'Chat Insights', icon: '📊' },
      { id: 'analytics', label: 'Creator Analytics', icon: '📈' },
      { id: 'compare', label: 'Compare Sessions', icon: '⚖️' },
      { id: 'history', label: 'Session History', icon: '🕒' },
      { id: 'multiroom', label: 'Multi-Room', icon: '🪟' },
    ],
  },
];

function ConnectBarTools({
  showStream,
  setShowStream,
  trackedCount,
  alertCount,
  onOpen,
  moreRef,
  showMore,
  setShowMore,
}: {
  showStream: boolean;
  setShowStream: React.Dispatch<React.SetStateAction<boolean>>;
  trackedCount: number;
  alertCount: number;
  onOpen: (tool: LiveTool) => void;
  moreRef: React.MutableRefObject<HTMLDivElement | null>;
  showMore: boolean;
  setShowMore: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <>
      <ToolbarBtn active={showStream} onClick={() => setShowStream((v) => !v)} title="Watch (⌘W)">
        Watch
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onOpen('tracked')} title="Tracked users" badge={trackedCount}>
        ★ Tracked
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onOpen('alerts')} title="Alerts" badge={alertCount} badgeAccent>
        Alerts
      </ToolbarBtn>
      <div ref={moreRef} className="relative">
        <ToolbarBtn onClick={() => setShowMore((v) => !v)} active={showMore}>
          Tools ▾
        </ToolbarBtn>
        {showMore && (
          <div className="absolute right-0 top-9 z-50 w-56 rounded-xl border border-zinc-800/60 bg-zinc-950/95 py-2 shadow-2xl backdrop-blur">
            {TOOLS_GROUPS.map((group, gi) => (
              <div key={group.group} className={gi > 0 ? 'mt-1.5 border-t border-zinc-800/50 pt-1.5' : ''}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  {group.group}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { onOpen(item.id); setShowMore(false); }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800/80"
                  >
                    <span className="text-sm">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  // Page + feed tab live in the shared UI store (src/state/ui.ts) so the
  // Fan Memory panel and pages can navigate (e.g. "Open full profile →").
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const page = useUI((s) => s.page);
  const setPage = useUI((s) => s.setPage);
  const liveTool = useUI((s) => s.liveTool);
  const openLiveTool = useUI((s) => s.openLiveTool);
  const [showStream, setShowStream] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMore]);
  const setStatus = useStore((s) => s.setStatus);
  const ingest = useStore((s) => s.ingest);
  const status = useStore((s) => s.status);
  const checkAlert = useAlerts((s) => s.checkEvent);
  const pushToast = useAlerts((s) => s.pushToast);
  const loadTracked = useTracked((s) => s.load);
  const trackedCount = useTracked((s) => s.list.length);
  const alertCount = useAlerts((s) => s.history.length);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    loadTracked();
  }, [loadTracked]);

  useEffect(() => {
    const offStatus = window.tiktok.onStatus(({ status, error }) => {
      setStatus(status as any, error);
    });
    const offEvent = window.tiktok.onEvent((evt) => {
      ingest(evt);
      checkAlert(evt, useStore.getState().viewerCount);
    });
    const offWatchlist = window.tiktok.onWatchlistLive(({ username }) => {
      pushToast({
        title: 'Watchlist: live now',
        body: `@${username} just started a TikTok Live`,
      });
    });
    return () => {
      offStatus();
      offEvent();
      offWatchlist();
    };
  }, [setStatus, ingest, checkAlert, pushToast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === '1') { e.preventDefault(); setTab('comments'); }
      if (mod && e.key === '2') { e.preventDefault(); setTab('gifts'); }
      if (mod && e.key === '3') { e.preventDefault(); setTab('questions'); }
      if (mod && e.key === '4') { e.preventDefault(); setTab('all'); }
      const ui = useUI.getState();
      const toggleTool = (tool: LiveTool) =>
        ui.page === 'live' && ui.liveTool === tool ? ui.openLiveTool('feed') : ui.openLiveTool(tool);
      if (mod && e.key === 'h') { e.preventDefault(); toggleTool('history'); }
      if (mod && e.key === 'l') { e.preventDefault(); toggleTool('leaderboard'); }
      if (mod && e.key === 'm') { e.preventDefault(); toggleTool('multiroom'); }
      if (mod && e.key === 'i') { e.preventDefault(); toggleTool('insights'); }
      if (mod && e.key === 'w') { e.preventDefault(); setShowStream((v) => !v); }
      if (mod && e.key === 't') { e.preventDefault(); toggleTool('transcript'); }
      if (mod && e.key === 'k') { e.preventDefault(); setShowCommandPalette((v) => !v); }
      if (e.key === 'Escape') {
        setShowCommandPalette(false); setShowMore(false);
        // Esc backs an in-content tool out to the live feed
        if (ui.page === 'live' && ui.liveTool !== 'feed') ui.openLiveTool('feed');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="relative flex h-screen flex-col">
      <ConnectBar
        rightExtras={
          <ConnectBarTools
            showStream={showStream}
            setShowStream={setShowStream}
            trackedCount={trackedCount}
            alertCount={alertCount}
            onOpen={openLiveTool}
            moreRef={moreRef}
            showMore={showMore}
            setShowMore={setShowMore}
          />
        }
      />

      {page === 'live' && <StatsStrip />}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar showStream={showStream} onToggleStream={() => setShowStream((v) => !v)} />
        {page === 'live' && (
          <main className="flex flex-1 gap-3 overflow-hidden p-3">
            {liveTool !== 'feed' ? (
              <LiveToolView tool={liveTool} onClose={() => openLiveTool('feed')} />
            ) : (
            <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
              {status === 'connected' ? (
                <>
                  <div className="flex items-center gap-1 border-b border-zinc-800/50 px-2 py-1.5">
                    <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>Comments</TabButton>
                    <TabButton active={tab === 'gifts'} onClick={() => setTab('gifts')}>Gifts</TabButton>
                    <TabButton active={tab === 'questions'} onClick={() => setTab('questions')}>Q&amp;A</TabButton>
                    <TabButton active={tab === 'top'} onClick={() => setTab('top')}>Top</TabButton>
                    <TabButton active={tab === 'all'} onClick={() => setTab('all')}>All</TabButton>
                    <div className="ml-auto flex items-center gap-1">
                      <FeedFilterMenu />
                      <FeedKebabMenu />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {tab === 'comments' && <CommentFeed />}
                    {tab === 'gifts' && <GiftFeed />}
                    {tab === 'questions' && <QuestionFeed />}
                    {tab === 'top' && <TopContributors />}
                    {tab === 'all' && <AllFeed />}
                  </div>
                  <NoteComposer />
                </>
              ) : (
                <EmptyState
                  onOpenHistory={() => openLiveTool('history')}
                  onOpenTracked={() => openLiveTool('tracked')}
                />
              )}
            </section>
            )}
            {showStream && status === 'connected' && !WIDE_TOOLS.has(liveTool) && (
              <StreamPlayer onClose={() => setShowStream(false)} />
            )}
            {status === 'connected' && <FanMemoryPanel />}
          </main>
        )}
        {page === 'dashboard' && (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Dashboard onOpenHistory={() => openLiveTool('history')} onGoLive={() => setPage('live')} onGoReminders={() => setPage('reminders')} />
          </main>
        )}
        {page !== 'live' && page !== 'dashboard' && (
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {page === 'followers' && <Followers onGoImport={() => setPage('import')} onGoLive={() => setPage('live')} />}
            {page === 'gifts' && <Gifts onGoLive={() => setPage('live')} />}
            {page === 'reminders' && <Reminders />}
            {page === 'messages' && <MessagesPage />}
            {page === 'import' && <ImportPage onGoFollowers={() => setPage('followers')} />}
            {page === 'settings' && <SettingsPage />}
          </main>
        )}

      </div>

      <UserDetailDrawer />
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          commands={[
            { id: 'tab-comments', label: 'Switch to Comments', hint: '⌘1', group: 'Tabs', icon: '💬', run: () => setTab('comments') },
            { id: 'tab-gifts', label: 'Switch to Gifts', hint: '⌘2', group: 'Tabs', icon: '🎁', run: () => setTab('gifts') },
            { id: 'tab-questions', label: 'Switch to Q&A', hint: '⌘3', group: 'Tabs', icon: '❓', run: () => setTab('questions') },
            { id: 'tab-all', label: 'Switch to All events', hint: '⌘4', group: 'Tabs', icon: '📜', run: () => setTab('all') },
            { id: 'panel-stream', label: 'Toggle stream player', hint: '⌘W', group: 'Panels', icon: '▶️', run: () => setShowStream((v) => !v) },
            { id: 'panel-feed', label: 'Open Live Feed', group: 'Panels', icon: '📡', run: () => openLiveTool('feed') },
            { id: 'panel-history', label: 'Open Session History', hint: '⌘H', group: 'Panels', icon: '🕒', run: () => openLiveTool('history') },
            { id: 'panel-leaderboard', label: 'Open All-Time Leaderboard', hint: '⌘L', group: 'Panels', icon: '🏆', run: () => openLiveTool('leaderboard') },
            { id: 'panel-multi', label: 'Open Multi-Room Monitor', hint: '⌘M', group: 'Panels', icon: '🪟', run: () => openLiveTool('multiroom') },
            { id: 'panel-insights', label: 'Open Chat Insights', hint: '⌘I', group: 'Panels', icon: '📊', run: () => openLiveTool('insights') },
            { id: 'panel-transcript', label: 'Open Live Transcript', hint: '⌘T', group: 'Panels', icon: '🎙️', run: () => openLiveTool('transcript') },
            { id: 'panel-alerts', label: 'Open Alerts', group: 'Panels', icon: '🔔', run: () => openLiveTool('alerts') },
            { id: 'panel-mod', label: 'Open Moderation', group: 'Panels', icon: '🛡️', run: () => openLiveTool('mod') },
            { id: 'panel-analytics', label: 'Open Creator Analytics', group: 'Panels', icon: '📈', run: () => openLiveTool('analytics') },
            { id: 'panel-compare', label: 'Compare Sessions', group: 'Panels', icon: '⚖️', run: () => openLiveTool('compare') },
            { id: 'panel-watchlist', label: 'Open Watchlist', group: 'Panels', icon: '👀', run: () => openLiveTool('watchlist') },
            { id: 'panel-highlights', label: 'Open Highlight Clips', group: 'Panels', icon: '🎬', run: () => openLiveTool('highlights') },
            { id: 'panel-liker', label: 'Open Live Liker', group: 'Panels', icon: '❤️', run: () => openLiveTool('liker') },
            { id: 'panel-fan-notes', label: 'Open Fan Notes', group: 'Panels', icon: '📝', run: () => openLiveTool('notes') },
            { id: 'panel-room-members', label: 'Open Room Members', group: 'Panels', icon: '👥', run: () => openLiveTool('room') },
            { id: 'panel-tracked', label: 'Open Tracked Users', group: 'Panels', icon: '★', run: () => openLiveTool('tracked') },
            { id: 'capture-clip', label: 'Capture last 60s as clip', group: 'Actions', icon: '✂️', run: () => window.tiktok.highlightsCapture('manual') },
            { id: 'disconnect', label: 'Disconnect', group: 'Connection', icon: '⏹️', run: () => window.tiktok.disconnect() },
          ]}
        />
      )}
      <AlertToasts />
    </div>
  );
}

/**
 * Tools that need horizontal room (grids / side-by-side charts). For these we
 * hide the StreamPlayer column but keep the Fan Memory panel visible.
 */
const WIDE_TOOLS = new Set<LiveTool>(['analytics', 'compare', 'history', 'multiroom']);

/**
 * Renders the selected live tool inside the content slot. Each panel already
 * renders into PanelShell (now an in-content card), so they slot straight in.
 * Closing a tool returns to the live feed.
 */
function LiveToolView({ tool, onClose }: { tool: LiveTool; onClose: () => void }) {
  switch (tool) {
    case 'tracked': return <TrackedUsersPanel onClose={onClose} />;
    case 'notes': return <FanNotesPanel onClose={onClose} />;
    case 'room': return <RoomMembersPanel onClose={onClose} />;
    case 'leaderboard': return <AllTimeLeaderboard onClose={onClose} />;
    case 'watchlist': return <FollowerWatchlist onClose={onClose} />;
    case 'alerts': return <AlertsPanel onClose={onClose} />;
    case 'mod': return <ModerationPanel onClose={onClose} />;
    case 'transcript': return <TranscriptPanel onClose={onClose} />;
    case 'highlights': return <HighlightsPanel onClose={onClose} />;
    case 'liker': return <LikerPanel onClose={onClose} />;
    case 'insights': return <WordCloud onClose={onClose} />;
    case 'analytics': return <CreatorAnalytics onClose={onClose} />;
    case 'compare': return <SessionComparison onClose={onClose} />;
    case 'history': return <HistoryView onClose={onClose} />;
    case 'multiroom': return <MultiRoom onClose={onClose} />;
    default: return null;
  }
}

const FILTER_LABELS: Record<FeedFilter, string> = {
  all: 'All viewers',
  followers: 'Followers',
  subs: 'Subscribers',
  mods: 'Moderators',
  gifters: 'Top gifters',
};

/** "Filter ▾" — narrows the Comments feed to a viewer segment. */
function FeedFilterMenu() {
  const feedFilter = useUI((s) => s.feedFilter);
  const setFeedFilter = useUI((s) => s.setFeedFilter);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${feedFilter !== 'all' ? 'bg-like-500/15 text-like-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
      >
        Filter {feedFilter !== 'all' ? `· ${FILTER_LABELS[feedFilter]}` : ''} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 w-40 rounded-xl border border-zinc-800/60 bg-zinc-950/95 py-1.5 shadow-2xl backdrop-blur">
          {(Object.keys(FILTER_LABELS) as FeedFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFeedFilter(f); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800/80 ${feedFilter === f ? 'font-bold text-like-400' : 'text-zinc-300'}`}
            >
              {FILTER_LABELS[f]}
              {feedFilter === f && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "⋮" feed menu — small utilities. */
function FeedKebabMenu() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const copyStats = async () => {
    const s = useStore.getState();
    const text = `LIVE @${s.roomInfo?.hostUniqueId ?? s.username}: ${s.totalLikes} likes · ${s.viewerCount} viewers · ${s.commentCount} comments · ${s.totalDiamonds} diamonds · ${s.giftCount} gifts`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full px-2 py-1 text-sm leading-none text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
        title="Feed menu"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 w-44 rounded-xl border border-zinc-800/60 bg-zinc-950/95 py-1.5 shadow-2xl backdrop-blur">
          <button onClick={copyStats} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800/80">
            📋 {copied ? 'Copied ✓' : 'Copy session stats'}
          </button>
          <button
            onClick={() => { useUI.getState().clearStreamNotes(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800/80"
          >
            🧹 Clear stream notes
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-pink-gradient text-white shadow-[0_2px_8px_rgba(238,29,82,0.35)]' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}
