import { forwardRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuItem, MenuGroup } from './components/ui/Menu';
import { Tabs, TabList, Tab } from './components/ui';
import { ConnectBar } from './components/ConnectBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Followers } from './pages/Followers';
import { FanProfile } from './pages/FanProfile';
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
import { FanPeek } from './components/FanPeek';
import { HighlightsPanel } from './components/HighlightsPanel';
import { LikerPanel } from './components/LikerPanel';
import { FanNotesPanel } from './components/FanNotesPanel';
import { RoomMembersPanel } from './components/RoomMembersPanel';
import { TrackedUsersPanel } from './components/TrackedUsersPanel';
import { StatsStrip } from './components/StatsStrip';
import { EmptyState } from './components/EmptyState';
import { FanMemoryPanel } from './components/FanMemoryPanel';
import { ResurfacedRegularAlert } from './components/ResurfacedRegularAlert';
import { NoteComposer } from './components/NoteComposer';
import { useStore } from './state/store';
import { useAlerts } from './state/alerts';
import { useTracked } from './state/tracked';
import { useModeration } from './state/moderation';
import { useUI, type FeedFilter, type LiveTool, type Page } from './state/ui';

const ToolbarBtn = forwardRef<
  HTMLButtonElement,
  { active?: boolean; onClick?: () => void; children: React.ReactNode; title?: string; badge?: number; badgeAccent?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ToolbarBtn({ active, onClick, children, title, badge, badgeAccent, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      title={title}
      className={`no-drag panel-btn ${active ? 'panel-btn-active' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="panel-btn-badge" style={badgeAccent ? { background: 'var(--brand-pink)', color: 'white' } : undefined}>{badge}</span>
      )}
    </button>
  );
});

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
  trackedCount,
  alertCount,
  onOpen,
}: {
  trackedCount: number;
  alertCount: number;
  onOpen: (tool: LiveTool) => void;
}) {
  const showStream = useUI((s) => s.showStream);
  const setShowStream = useUI((s) => s.setShowStream);
  const setPlayerMinimized = useUI((s) => s.setPlayerMinimized);
  return (
    <>
      <ToolbarBtn
        active={showStream}
        onClick={() => {
          setShowStream((v) => !v);
          // Reopening the Watch toggle un-minimizes so it lands full on live.
          setPlayerMinimized(false);
        }}
        title="Watch (⌘W)"
      >
        Watch
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onOpen('tracked')} title="Tracked users" badge={trackedCount}>
        ★ Tracked
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onOpen('alerts')} title="Alerts" badge={alertCount} badgeAccent>
        Alerts
      </ToolbarBtn>
      <Menu
        trigger={<ToolbarBtn>Tools ▾</ToolbarBtn>}
        align="end"
        sideOffset={6}
        contentClassName="w-56"
      >
        {TOOLS_GROUPS.map((group, gi) => (
          <MenuGroup key={group.group} label={group.group} first={gi === 0}>
            {group.items.map((item) => (
              <MenuItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                onSelect={() => onOpen(item.id)}
              />
            ))}
          </MenuGroup>
        ))}
      </Menu>
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
  const showStream = useUI((s) => s.showStream);
  const setShowStream = useUI((s) => s.setShowStream);
  const playerMinimized = useUI((s) => s.playerMinimized);
  const commandOpen = useUI((s) => s.commandOpen);
  const setCommandOpen = useUI((s) => s.setCommandOpen);
  const setStatus = useStore((s) => s.setStatus);
  const ingest = useStore((s) => s.ingest);
  const status = useStore((s) => s.status);
  const checkAlert = useAlerts((s) => s.checkEvent);
  const pushToast = useAlerts((s) => s.pushToast);
  const loadTracked = useTracked((s) => s.load);
  const loadModeration = useModeration((s) => s.load);
  const trackedCount = useTracked((s) => s.list.length);
  const alertCount = useAlerts((s) => s.history.length);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    loadTracked();
    loadModeration();
  }, [loadTracked, loadModeration]);

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
    // Native go-live notification clicked → jump to the live page and connect to
    // that creator's room. Fail-safe: a bad payload must never throw here.
    const offNavConnect = window.tiktok.onNavigateConnect(({ username }) => {
      try {
        const u = String(username ?? '').trim().replace(/^@/, '');
        if (!u) return;
        useUI.getState().setPage('live');
        const st = useStore.getState();
        st.reset();
        st.setUsername(u);
        window.tiktok.connect(u).then((res) => {
          if (!res.ok) {
            useStore.getState().setStatus('error', res.error ?? `Couldn't connect to @${u}.`);
          }
        }).catch(() => {});
      } catch {
        /* never break the listener */
      }
    });
    return () => {
      offStatus();
      offEvent();
      offWatchlist();
      offNavConnect();
    };
  }, [setStatus, ingest, checkAlert, pushToast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // ⌘K is GLOBAL — it toggles the palette from any page and even while a
      // field is focused (Superhuman-style). Handle it before the input guard.
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        useUI.getState().setCommandOpen((v) => !v);
        return;
      }
      // Every other shortcut stays inert while typing in a field.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
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
      if (mod && e.key === 'w') { e.preventDefault(); ui.setShowStream((v) => !v); ui.setPlayerMinimized(false); }
      if (mod && e.key === 't') { e.preventDefault(); toggleTool('transcript'); }
      if (e.key === 'Escape') {
        useUI.getState().setCommandOpen(false);
        // Esc backs an in-content tool out to the live feed
        if (ui.page === 'live' && ui.liveTool !== 'feed') ui.openLiveTool('feed');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="relative flex h-screen">
      {/* Full-height navy sidebar — nothing ever renders above it. */}
      <Sidebar />

      {/* Right column: thin drag strip + the active page. */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Window-drag affordance (traffic lights live over the sidebar, so this
            strip is purely for moving the window from the right side). */}
        <div className="titlebar-drag h-8 flex-none" />

        {page === 'live' && (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* In-LIVE host/connect bar — only on the live page, never global. */}
            <ConnectBar
              rightExtras={
                <ConnectBarTools
                  trackedCount={trackedCount}
                  alertCount={alertCount}
                  onOpen={openLiveTool}
                />
              }
            />
            <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
              {liveTool !== 'feed' ? (
                <LiveToolView tool={liveTool} onClose={() => openLiveTool('feed')} />
              ) : (
              <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
                {status === 'connected' ? (
                  <>
                    <div className="flex h-[54px] flex-none items-center gap-2 border-b border-zinc-800/50 px-3">
                      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} variant="pill">
                        <TabList ariaLabel="Live feed">
                          <Tab value="comments" label="Comments" />
                          <Tab value="gifts" label="Gifts" />
                          <Tab value="questions" label="Q&A" />
                          <Tab value="top" label="Top" />
                          <Tab value="all" label="All" />
                        </TabList>
                      </Tabs>
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
              {/* FULL-mode player docks here via a portal target so the SAME
                  StreamPlayer DOM node (and its <video>) is reused — never
                  remounted — when switching full↔mini or navigating away. */}
              {showStream && status === 'connected' && !WIDE_TOOLS.has(liveTool) && (
                <div id="player-dock-full" className="flex h-full flex-none" />
              )}
              {/* Right rail: stat counters (top) then Fan Memory. */}
              {status === 'connected' && (
                <div className="flex w-[304px] flex-none flex-col gap-3 overflow-y-auto">
                  <StatsStrip />
                  <FanMemoryPanel />
                </div>
              )}
            </div>
            <ResurfacedRegularAlert />
          </main>
        )}
        {page === 'dashboard' && (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Dashboard onOpenHistory={() => openLiveTool('history')} onGoLive={() => setPage('live')} onGoReminders={() => setPage('reminders')} />
          </main>
        )}
        {page !== 'live' && page !== 'dashboard' && (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {page === 'fan' && <FanProfile />}
            {page === 'followers' && <Followers onGoImport={() => setPage('import')} onGoLive={() => setPage('live')} />}
            {page === 'gifts' && <Gifts onGoLive={() => setPage('live')} />}
            {page === 'reminders' && <Reminders />}
            {page === 'messages' && <MessagesPage />}
            {page === 'import' && <ImportPage onGoFollowers={() => setPage('followers')} />}
            {page === 'settings' && <SettingsPage />}
          </main>
        )}
      </div>

      {/* Persistent live player — mounted ONCE here at the App root so it does
          NOT unmount on page navigation. It keeps the live audio playing while
          the user browses the CRM. FULL mode portals into the live column's
          dock; MINI mode floats bottom-right. Either way it's the same instance
          and the same <video> node, so playback never interrupts. */}
      <PersistentPlayer
        show={showStream && status === 'connected'}
        page={page}
        liveTool={liveTool}
        minimized={playerMinimized}
        onClose={() => setShowStream(false)}
      />

      <UserDetailDrawer />

      {/* Global universal Fan PEEK — mounted ONCE so it overlays every page. */}
      <FanPeek />

      {commandOpen && (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          commands={[
            // Page navigation — available on every page.
            { id: 'go-dashboard', label: 'Go to Dashboard', group: 'Go to', icon: '🏠', run: () => setPage('dashboard') },
            { id: 'go-live', label: 'Go to Live', group: 'Go to', icon: '📡', run: () => setPage('live') },
            { id: 'go-followers', label: 'Go to Followers', group: 'Go to', icon: '👥', run: () => setPage('followers') },
            { id: 'go-gifts', label: 'Go to Gifts', group: 'Go to', icon: '🎁', run: () => setPage('gifts') },
            { id: 'go-reminders', label: 'Go to Reminders', group: 'Go to', icon: '⏰', run: () => setPage('reminders') },
            { id: 'go-messages', label: 'Go to Messages', group: 'Go to', icon: '💬', run: () => setPage('messages') },
            { id: 'go-import', label: 'Go to Import', group: 'Go to', icon: '📥', run: () => setPage('import') },
            { id: 'go-settings', label: 'Go to Settings', group: 'Go to', icon: '⚙️', run: () => setPage('settings') },
            // Live tabs (only meaningful on the live page, but harmless elsewhere).
            { id: 'tab-comments', label: 'Switch to Comments', hint: '⌘1', group: 'Tabs', icon: '💬', run: () => setTab('comments') },
            { id: 'tab-gifts', label: 'Switch to Gifts', hint: '⌘2', group: 'Tabs', icon: '🎁', run: () => setTab('gifts') },
            { id: 'tab-questions', label: 'Switch to Q&A', hint: '⌘3', group: 'Tabs', icon: '❓', run: () => setTab('questions') },
            { id: 'tab-all', label: 'Switch to All events', hint: '⌘4', group: 'Tabs', icon: '📜', run: () => setTab('all') },
            { id: 'panel-stream', label: 'Toggle stream player', hint: '⌘W', group: 'Panels', icon: '▶️', run: () => setShowStream((v) => !v) },
            { id: 'panel-stream-mini', label: 'Minimize / restore now-playing', group: 'Panels', icon: '🔉', run: () => useUI.getState().setPlayerMinimized((v) => !v) },
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
 * Single persistent StreamPlayer instance. Mounted once at the App root so it
 * survives page navigation (the live audio keeps playing while the user browses
 * the CRM).
 *
 * Display mode is derived, not a second instance:
 *   - FULL  → on the live page, not minimized, and the active tool leaves room
 *             for the player column. The player's DOM is portalled INTO the
 *             live column's `#player-dock-full` slot so it visually sits where
 *             it always did. Same component instance, same <video>.
 *   - MINI  → any other situation (navigated away, minimized, or a wide tool is
 *             open) → floats bottom-right as the "now playing" widget.
 *
 * Because `<StreamPlayer>` keeps a stable position in this component's render
 * tree, switching full↔mini (and re-targeting the portal) never remounts the
 * <video>, so playback is uninterrupted.
 */
function PersistentPlayer({
  show,
  page,
  liveTool,
  minimized,
  onClose,
}: {
  show: boolean;
  page: Page;
  liveTool: LiveTool;
  minimized: boolean;
  onClose: () => void;
}) {
  const wantsFull = show && page === 'live' && !minimized && !WIDE_TOOLS.has(liveTool);

  // A single, app-owned container DIV that the StreamPlayer always portals
  // into. We move THIS div (via appendChild) between the live-column dock and a
  // fixed root host. Reparenting a DOM node does NOT remount the React subtree
  // (the portal target — `container` — never changes), so the <video> survives
  // every full↔mini switch and every page navigation uninterrupted.
  const [container] = useState(() => document.createElement('div'));

  // The fixed host that anchors the mini widget at the App root.
  const [miniHost] = useState(() => {
    const el = document.createElement('div');
    el.id = 'player-mini-host';
    return el;
  });

  useEffect(() => {
    document.body.appendChild(miniHost);
    return () => {
      miniHost.remove();
    };
  }, [miniHost]);

  // Reparent the stable container into the right home for the current mode.
  useEffect(() => {
    if (!show) return;
    const dock = wantsFull ? document.getElementById('player-dock-full') : null;
    const target = dock ?? miniHost;
    if (container.parentElement !== target) target.appendChild(container);
    // Full mode stretches to the dock; mini mode positions itself (fixed).
    container.className = wantsFull ? 'flex h-full w-full' : 'contents';
  }, [show, wantsFull, page, liveTool, minimized, container, miniHost]);

  if (!show) return null;

  // `wantsFull` decides ONLY the display prop; the portal target (`container`)
  // is constant, so the StreamPlayer instance and its <video> never remount.
  return createPortal(
    <StreamPlayer display={wantsFull ? 'full' : 'mini'} onClose={onClose} />,
    container,
  );
}

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

const FilterPillTrigger = forwardRef<
  HTMLButtonElement,
  { activeFilter: FeedFilter } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function FilterPillTrigger({ activeFilter, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      aria-label="Filter feed by viewer segment"
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${activeFilter !== 'all' ? 'bg-like-500/15 text-like-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'} ${className ?? ''}`}
      {...rest}
    >
      Filter {activeFilter !== 'all' ? `· ${FILTER_LABELS[activeFilter]}` : ''} ▾
    </button>
  );
});

/** "Filter ▾" — narrows the Comments feed to a viewer segment. */
function FeedFilterMenu() {
  const feedFilter = useUI((s) => s.feedFilter);
  const setFeedFilter = useUI((s) => s.setFeedFilter);
  return (
    <Menu
      trigger={<FilterPillTrigger activeFilter={feedFilter} />}
      align="end"
      contentClassName="w-40"
    >
      {(Object.keys(FILTER_LABELS) as FeedFilter[]).map((f) => (
        <MenuItem
          key={f}
          label={FILTER_LABELS[f]}
          active={feedFilter === f}
          onSelect={() => setFeedFilter(f)}
        />
      ))}
    </Menu>
  );
}

const KebabTrigger = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function KebabTrigger({ className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={`rounded-full px-2 py-1 text-sm leading-none text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 ${className ?? ''}`}
        title="Feed menu"
        aria-label="Feed menu"
        {...rest}
      >
        ⋮
      </button>
    );
  },
);

/** "⋮" feed menu — small utilities. */
function FeedKebabMenu() {
  const copyStats = async () => {
    const s = useStore.getState();
    const subs = s.subscribeCount > 0 ? ` · ${s.subscribeCount} subs` : '';
    const text = `LIVE @${s.roomInfo?.hostUniqueId ?? s.username}: ${s.totalLikes} likes · ${s.viewerCount} viewers · ${s.commentCount} comments · ${s.totalDiamonds} diamonds · ${s.giftCount} gifts${subs}`;
    try {
      await navigator.clipboard.writeText(text);
      useAlerts.getState().pushToast({ title: 'Copied session stats', body: text });
    } catch {
      useAlerts.getState().pushToast({ title: 'Copy failed', body: 'Could not access the clipboard.' });
    }
  };
  return (
    <Menu trigger={<KebabTrigger />} align="end" contentClassName="w-44">
      <MenuItem icon="📋" label="Copy session stats" onSelect={copyStats} />
    </Menu>
  );
}

