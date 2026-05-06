import { useEffect, useRef, useState } from 'react';
import { ConnectBar } from './components/ConnectBar';
import { Sidebar, type SidebarPanel } from './components/Sidebar';
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
import { useStore } from './state/store';
import { useAlerts } from './state/alerts';
import { useTracked } from './state/tracked';

type Tab = 'comments' | 'gifts' | 'questions' | 'top' | 'all';

function ToolbarBtn({ active, onClick, children, title, badge }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag panel-btn ${active ? 'panel-btn-active' : ''}`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="panel-btn-badge">{badge}</span>
      )}
    </button>
  );
}

const TOOLS_GROUPS: { group: string; items: { id: string; label: string; icon: string }[] }[] = [
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
      { id: 'multi', label: 'Multi-Room', icon: '🪟' },
    ],
  },
];

function ConnectBarTools({
  showStream,
  setShowStream,
  trackedCount,
  onOpen,
  moreRef,
  showMore,
  setShowMore,
}: {
  showStream: boolean;
  setShowStream: React.Dispatch<React.SetStateAction<boolean>>;
  trackedCount: number;
  onOpen: (panel: string) => void;
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
      <ToolbarBtn onClick={() => onOpen('alerts')} title="Alerts">
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
  const [tab, setTab] = useState<Tab>('comments');
  const [activePanel, setActivePanel] = useState<SidebarPanel>('live');
  const [showHistory, setShowHistory] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showWordCloud, setShowWordCloud] = useState(false);
  const [showMultiRoom, setShowMultiRoom] = useState(false);
  const [showModeration, setShowModeration] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [showLiker, setShowLiker] = useState(false);
  const [showFanNotes, setShowFanNotes] = useState(false);
  const [showRoomMembers, setShowRoomMembers] = useState(false);
  const [showTracked, setShowTracked] = useState(false);
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
      if (mod && e.key === 'h') { e.preventDefault(); setShowHistory((v) => !v); }
      if (mod && e.key === 'l') { e.preventDefault(); setShowLeaderboard((v) => !v); }
      if (mod && e.key === 'm') { e.preventDefault(); setShowMultiRoom((v) => !v); }
      if (mod && e.key === 'i') { e.preventDefault(); setShowWordCloud((v) => !v); }
      if (mod && e.key === 'w') { e.preventDefault(); setShowStream((v) => !v); }
      if (mod && e.key === 't') { e.preventDefault(); setShowTranscript((v) => !v); }
      if (mod && e.key === 'k') { e.preventDefault(); setShowCommandPalette((v) => !v); }
      if (e.key === 'Escape') {
        setShowHistory(false); setShowLeaderboard(false); setShowAlerts(false);
        setShowWordCloud(false); setShowMultiRoom(false); setShowModeration(false);
        setShowComparison(false); setShowAnalytics(false); setShowWatchlist(false);
        setShowTranscript(false); setShowCommandPalette(false); setShowHighlights(false); setShowMore(false);
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
            onOpen={(panel) => {
              if (panel === 'tracked') setShowTracked(true);
              if (panel === 'notes') setShowFanNotes(true);
              if (panel === 'alerts') setShowAlerts(true);
              if (panel === 'room') setShowRoomMembers(true);
              if (panel === 'insights') setShowWordCloud(true);
              if (panel === 'mod') setShowModeration(true);
              if (panel === 'multi') setShowMultiRoom(true);
              if (panel === 'leaderboard') setShowLeaderboard(true);
              if (panel === 'history') setShowHistory(true);
              if (panel === 'transcript') setShowTranscript(true);
              if (panel === 'highlights') setShowHighlights(true);
              if (panel === 'analytics') setShowAnalytics(true);
              if (panel === 'compare') setShowComparison(true);
              if (panel === 'watchlist') setShowWatchlist(true);
              if (panel === 'liker') setShowLiker(true);
            }}
            moreRef={moreRef}
            showMore={showMore}
            setShowMore={setShowMore}
          />
        }
      />

      <StatsStrip />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          active={activePanel}
          onSelect={(id) => {
            setActivePanel(id);
            // Open the matching panel overlay (Live = no overlay = main feed)
            if (id === 'tracked') setShowTracked(true);
            else if (id === 'notes') setShowFanNotes(true);
            else if (id === 'room') setShowRoomMembers(true);
            else if (id === 'leaderboard') setShowLeaderboard(true);
            else if (id === 'watchlist') setShowWatchlist(true);
            else if (id === 'alerts') setShowAlerts(true);
            else if (id === 'mod') setShowModeration(true);
            else if (id === 'transcript') setShowTranscript(true);
            else if (id === 'highlights') setShowHighlights(true);
            else if (id === 'liker') setShowLiker(true);
            else if (id === 'insights') setShowWordCloud(true);
            else if (id === 'analytics') setShowAnalytics(true);
            else if (id === 'compare') setShowComparison(true);
            else if (id === 'history') setShowHistory(true);
            else if (id === 'multi') setShowMultiRoom(true);
          }}
          showStream={showStream}
          onToggleStream={() => setShowStream((v) => !v)}
        />
        <main className="flex flex-1 gap-3 overflow-hidden p-3">
          <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
            {status === 'connected' ? (
              <>
                <div className="flex items-center gap-1 border-b border-zinc-800/50 px-2 py-1.5">
                  <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>Comments</TabButton>
                  <TabButton active={tab === 'gifts'} onClick={() => setTab('gifts')}>Gifts</TabButton>
                  <TabButton active={tab === 'questions'} onClick={() => setTab('questions')}>Q&amp;A</TabButton>
                  <TabButton active={tab === 'top'} onClick={() => setTab('top')}>Top</TabButton>
                  <TabButton active={tab === 'all'} onClick={() => setTab('all')}>All</TabButton>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {tab === 'comments' && <CommentFeed />}
                  {tab === 'gifts' && <GiftFeed />}
                  {tab === 'questions' && <QuestionFeed />}
                  {tab === 'top' && <TopContributors />}
                  {tab === 'all' && <AllFeed />}
                </div>
              </>
            ) : (
              <EmptyState
                onOpenHistory={() => setShowHistory(true)}
                onOpenTracked={() => setShowTracked(true)}
              />
            )}
          </section>
        </main>

        {showStream && status === 'connected' && <StreamPlayer onClose={() => setShowStream(false)} />}
      </div>

      <UserDetailDrawer />
      {showWordCloud && <WordCloud onClose={() => { setShowWordCloud(false); setActivePanel('live'); }} />}
      {showModeration && <ModerationPanel onClose={() => { setShowModeration(false); setActivePanel('live'); }} />}
      {showAlerts && <AlertsPanel onClose={() => { setShowAlerts(false); setActivePanel('live'); }} />}
      {showLeaderboard && <AllTimeLeaderboard onClose={() => { setShowLeaderboard(false); setActivePanel('live'); }} />}
      {showMultiRoom && <MultiRoom onClose={() => { setShowMultiRoom(false); setActivePanel('live'); }} />}
      {showAnalytics && <CreatorAnalytics onClose={() => { setShowAnalytics(false); setActivePanel('live'); }} />}
      {showComparison && <SessionComparison onClose={() => { setShowComparison(false); setActivePanel('live'); }} />}
      {showWatchlist && <FollowerWatchlist onClose={() => { setShowWatchlist(false); setActivePanel('live'); }} />}
      {showTranscript && <TranscriptPanel onClose={() => { setShowTranscript(false); setActivePanel('live'); }} />}
      {showHighlights && <HighlightsPanel onClose={() => { setShowHighlights(false); setActivePanel('live'); }} />}
      {showLiker && <LikerPanel onClose={() => { setShowLiker(false); setActivePanel('live'); }} />}
      {showFanNotes && <FanNotesPanel onClose={() => { setShowFanNotes(false); setActivePanel('live'); }} />}
      {showRoomMembers && <RoomMembersPanel onClose={() => { setShowRoomMembers(false); setActivePanel('live'); }} />}
      {showTracked && <TrackedUsersPanel onClose={() => { setShowTracked(false); setActivePanel('live'); }} />}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          commands={[
            { id: 'tab-comments', label: 'Switch to Comments', hint: '⌘1', group: 'Tabs', icon: '💬', run: () => setTab('comments') },
            { id: 'tab-gifts', label: 'Switch to Gifts', hint: '⌘2', group: 'Tabs', icon: '🎁', run: () => setTab('gifts') },
            { id: 'tab-questions', label: 'Switch to Q&A', hint: '⌘3', group: 'Tabs', icon: '❓', run: () => setTab('questions') },
            { id: 'tab-all', label: 'Switch to All events', hint: '⌘4', group: 'Tabs', icon: '📜', run: () => setTab('all') },
            { id: 'panel-stream', label: 'Toggle stream player', hint: '⌘W', group: 'Panels', icon: '▶️', run: () => setShowStream((v) => !v) },
            { id: 'panel-history', label: 'Open Session History', hint: '⌘H', group: 'Panels', icon: '🕒', run: () => setShowHistory(true) },
            { id: 'panel-leaderboard', label: 'Open All-Time Leaderboard', hint: '⌘L', group: 'Panels', icon: '🏆', run: () => setShowLeaderboard(true) },
            { id: 'panel-multi', label: 'Open Multi-Room Monitor', hint: '⌘M', group: 'Panels', icon: '🪟', run: () => setShowMultiRoom(true) },
            { id: 'panel-insights', label: 'Open Chat Insights', hint: '⌘I', group: 'Panels', icon: '📊', run: () => setShowWordCloud(true) },
            { id: 'panel-transcript', label: 'Open Live Transcript', hint: '⌘T', group: 'Panels', icon: '🎙️', run: () => setShowTranscript(true) },
            { id: 'panel-alerts', label: 'Open Alerts', group: 'Panels', icon: '🔔', run: () => setShowAlerts(true) },
            { id: 'panel-mod', label: 'Open Moderation', group: 'Panels', icon: '🛡️', run: () => setShowModeration(true) },
            { id: 'panel-analytics', label: 'Open Creator Analytics', group: 'Panels', icon: '📈', run: () => setShowAnalytics(true) },
            { id: 'panel-compare', label: 'Compare Sessions', group: 'Panels', icon: '⚖️', run: () => setShowComparison(true) },
            { id: 'panel-watchlist', label: 'Open Watchlist', group: 'Panels', icon: '👀', run: () => setShowWatchlist(true) },
            { id: 'panel-highlights', label: 'Open Highlight Clips', group: 'Panels', icon: '🎬', run: () => setShowHighlights(true) },
            { id: 'panel-liker', label: 'Open Live Liker', group: 'Panels', icon: '❤️', run: () => setShowLiker(true) },
            { id: 'panel-fan-notes', label: 'Open Fan Notes', group: 'Panels', icon: '📝', run: () => setShowFanNotes(true) },
            { id: 'panel-room-members', label: 'Open Room Members', group: 'Panels', icon: '👥', run: () => setShowRoomMembers(true) },
            { id: 'panel-tracked', label: 'Open Tracked Users', group: 'Panels', icon: '★', run: () => setShowTracked(true) },
            { id: 'capture-clip', label: 'Capture last 60s as clip', group: 'Actions', icon: '✂️', run: () => window.tiktok.highlightsCapture('manual') },
            { id: 'disconnect', label: 'Disconnect', group: 'Connection', icon: '⏹️', run: () => window.tiktok.disconnect() },
          ]}
        />
      )}
      {showHistory && <HistoryView onClose={() => { setShowHistory(false); setActivePanel('live'); }} />}
      <AlertToasts />
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
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}
