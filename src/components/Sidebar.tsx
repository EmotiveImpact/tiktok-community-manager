import {
  LayoutDashboard, Radio, Users, Gift, CalendarDays, MessageSquare, Upload, Settings, ChevronRight, ChevronLeft,
  Star, StickyNote, Trophy, Eye, Bell, Shield, Mic, Clapperboard, Heart,
  BarChart3, TrendingUp, Scale, History, Grid2x2, Play,
  type LucideIcon,
} from 'lucide-react';
import { useTracked } from '../state/tracked';
import { useStore } from '../state/store';
import { useAlerts } from '../state/alerts';
import { useUI, type Page, type LiveTool } from '../state/ui';

export type { Page };

const PRIMARY: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'live', label: 'Live Feed', icon: Radio },
  { id: 'followers', label: 'Followers', icon: Users },
  { id: 'gifts', label: 'Gifts', icon: Gift },
  { id: 'reminders', label: 'Reminders', icon: CalendarDays },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'settings', label: 'Settings', icon: Settings },
];

type Item = { id: LiveTool; label: string; icon: LucideIcon };

const LIVE_SECTIONS: { group: string; items: Item[] }[] = [
  {
    group: 'Audience',
    items: [
      { id: 'tracked', label: 'Tracked Users', icon: Star },
      { id: 'notes', label: 'Fan Notes', icon: StickyNote },
      { id: 'room', label: 'Room Members', icon: Users },
      { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
      { id: 'watchlist', label: 'Watchlist', icon: Eye },
    ],
  },
  {
    group: 'Live tools',
    items: [
      { id: 'alerts', label: 'Alerts', icon: Bell },
      { id: 'mod', label: 'Moderation', icon: Shield },
      { id: 'transcript', label: 'Transcript', icon: Mic },
      { id: 'highlights', label: 'Highlight Clips', icon: Clapperboard },
      { id: 'liker', label: 'Live Liker', icon: Heart },
    ],
  },
  {
    group: 'Insights',
    items: [
      { id: 'insights', label: 'Chat Insights', icon: BarChart3 },
      { id: 'analytics', label: 'Creator Analytics', icon: TrendingUp },
      { id: 'compare', label: 'Compare', icon: Scale },
      { id: 'history', label: 'Session History', icon: History },
      { id: 'multiroom', label: 'Multi-Room', icon: Grid2x2 },
    ],
  },
];

type Props = {
  showStream: boolean;
  onToggleStream: () => void;
};

/* Sidebar keeps its navy gradient in both themes (brand mockup). */
const NAVY_TEXT = 'rgba(226, 232, 248, 0.9)';
const NAVY_MUTED = 'rgba(148, 163, 184, 0.9)';
const NAVY_FAINT = 'rgba(120, 130, 165, 0.55)';
const NAVY_HOVER = 'rgba(255, 255, 255, 0.05)';

const ACTIVE_PILL = {
  background: 'linear-gradient(90deg, #EE1D52, #ff4d76)',
  boxShadow: '0 6px 16px rgba(238,29,82,0.35)',
  color: 'white',
} as const;

function LogoMark() {
  return (
    <div className="mb-4 flex items-center gap-3 px-1 pt-4">
      <span
        className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl"
        style={{ background: '#10142a' }}
      >
        {/* TikTok-style note mark (matches web app) */}
        <svg width="22" height="22" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M30 8v20.5a9.5 9.5 0 1 1-9.5-9.5" stroke="#69C9D0" strokeWidth="5" strokeLinecap="round" />
          <path d="M33 11c3.8 4.1 7.1 5.9 11 6.4" stroke="#EE1D52" strokeWidth="5" strokeLinecap="round" />
          <path d="M26 8v21a7 7 0 1 1-7-7" stroke="white" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[15px] font-extrabold text-white">TikTok</span>
        <span className="block text-xs font-medium" style={{ color: NAVY_MUTED }}>Community Manager</span>
      </span>
    </div>
  );
}

function hoverable(isActive: boolean) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!isActive) { e.currentTarget.style.background = NAVY_HOVER; e.currentTarget.style.color = 'white'; }
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = NAVY_MUTED; }
    },
  };
}

export function Sidebar({ showStream, onToggleStream }: Props) {
  const page = useUI((s) => s.page);
  const setPage = useUI((s) => s.setPage);
  const sidebarMode = useUI((s) => s.sidebarMode);
  const liveTool = useUI((s) => s.liveTool);
  const openLiveTool = useUI((s) => s.openLiveTool);
  const backToMain = useUI((s) => s.backToMain);

  const trackedCount = useTracked((s) => s.list.length);
  const roomCount = useStore((s) => s.roomMembers.size);
  const alertCount = useAlerts((s) => s.history.length);
  const status = useStore((s) => s.status);
  const room = useStore((s) => s.roomInfo);
  const connected = status === 'connected';

  const counts: Partial<Record<LiveTool, number>> = {
    tracked: trackedCount,
    room: roomCount,
    alerts: alertCount,
  };

  return (
    <aside
      className="flex h-full min-h-0 w-[230px] flex-none flex-col px-4 pb-4"
      style={{
        background: 'var(--gradient-sidebar)',
        borderRight: '1px solid rgba(120, 134, 178, 0.14)',
      }}
    >
      <LogoMark />

      {/* The sidebar "flips" between the main app nav and the live toolset. */}
      <div
        key={sidebarMode}
        className={`flex min-h-0 flex-1 flex-col ${sidebarMode === 'live' ? 'sidebar-flip-in' : 'sidebar-flip-back'}`}
      >
        {sidebarMode === 'main' ? (
          <nav aria-label="Main navigation" className="no-drag min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {PRIMARY.map((it) => {
              const isActive = page === it.id;
              const Icon = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setPage(it.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className="group flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-left text-[13px] font-medium transition-colors"
                  style={isActive ? ACTIVE_PILL : { color: NAVY_MUTED }}
                  {...hoverable(isActive)}
                >
                  <Icon size={17} style={{ color: isActive ? 'white' : undefined }} className="flex-none" />
                  <span className="flex-1">{it.label}</span>
                  {it.id === 'live' && connected && (
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full"
                      style={{ background: isActive ? 'white' : '#ee1d52', boxShadow: '0 0 6px rgba(238,29,82,0.8)' }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        ) : (
          <nav aria-label="Live tools" className="no-drag min-h-0 flex-1 overflow-y-auto">
            {/* Back to the main menu (stays connected; lands on Dashboard) */}
            <button
              type="button"
              onClick={backToMain}
              className="mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors"
              style={{ color: NAVY_TEXT, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(120,134,178,0.18)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = NAVY_HOVER; e.currentTarget.style.color = 'white'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = NAVY_TEXT; }}
            >
              <ChevronLeft size={15} className="flex-none" />
              <span className="flex-1">Back</span>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#ff5b85' }}>Live</span>
            </button>

            <div className="px-1 pb-1">
              <button
                type="button"
                onClick={onToggleStream}
                disabled={!connected}
                className="no-drag flex w-full items-center justify-center gap-2 rounded-full px-2.5 py-1.5 text-left text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background: 'linear-gradient(90deg, #EE1D52, #ff4d76)',
                  color: 'white',
                  boxShadow: showStream ? '0 0 0 2px rgba(255,255,255,0.35), 0 6px 16px rgba(238,29,82,0.4)' : '0 6px 16px rgba(238,29,82,0.35)',
                }}
              >
                <Play size={13} className="flex-none" fill="white" />
                <span>Watch Stream</span>
                {showStream && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" style={{ boxShadow: '0 0 6px rgba(255,255,255,0.9)' }} />
                )}
              </button>
            </div>

            {/* The feed itself, then the tool groups */}
            <LiveItem
              item={{ id: 'feed', label: 'Live Feed', icon: Radio }}
              isActive={liveTool === 'feed'}
              onClick={() => openLiveTool('feed')}
              extra={connected ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: liveTool === 'feed' ? '#ff5b85' : '#ee1d52', boxShadow: '0 0 6px rgba(238,29,82,0.8)' }} />
              ) : undefined}
            />

            {LIVE_SECTIONS.map((section) => (
              <div key={section.group} className="mt-1.5">
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: NAVY_FAINT }}>
                  {section.group}
                </div>
                {section.items.map((item) => (
                  <LiveItem
                    key={item.id}
                    item={item}
                    isActive={liveTool === item.id}
                    onClick={() => openLiveTool(item.id)}
                    count={counts[item.id]}
                  />
                ))}
              </div>
            ))}
          </nav>
        )}
      </div>

      {/* Mission mini-card (web design) */}
      <div className="no-drag mb-3 mt-2 flex-none rounded-2xl p-3.5" style={{ background: 'rgba(238,29,82,0.10)', border: '1px solid rgba(238,29,82,0.25)' }}>
        <img src="./assets/png/icon_heart_3d.png" alt="" className="mb-2 h-9 w-9" draggable={false} />
        <div className="text-sm font-semibold leading-snug text-white">Never forget your people.</div>
        <div className="mt-1 text-xs leading-snug" style={{ color: NAVY_MUTED }}>They support you, we help you remember.</div>
      </div>

      {/* Creator profile card (web design) */}
      <div className="no-drag flex flex-none items-center gap-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {connected && room?.hostAvatar ? (
          <img src={room.hostAvatar} alt="" className="h-9 w-9 flex-none rounded-full object-cover ring-2 ring-[#EE1D52]/60" />
        ) : (
          <span
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#EE1D52,#69C9D0)' }}
          >
            {connected && room ? room.hostNickname.charAt(0).toUpperCase() : 'C'}
          </span>
        )}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-white">
            {connected && room ? room.hostNickname : 'Creator'}
          </span>
          <span className="block truncate text-[11px]" style={{ color: connected ? '#ff5b85' : NAVY_MUTED }}>
            {connected && room ? `● LIVE · @${room.hostUniqueId}` : 'LIVE Creator'}
          </span>
        </span>
        <ChevronRight size={15} className="flex-none" style={{ color: 'rgba(100,116,139,1)' }} />
      </div>
    </aside>
  );
}

function LiveItem({ item, isActive, onClick, count, extra }: {
  item: Item;
  isActive: boolean;
  onClick: () => void;
  count?: number;
  extra?: React.ReactNode;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'true' : undefined}
      className="no-drag mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-[5px] text-left text-[12px] transition"
      style={{
        background: isActive ? 'rgba(238, 29, 82, 0.16)' : 'transparent',
        color: isActive ? '#ff5b85' : NAVY_MUTED,
        fontWeight: isActive ? 700 : 500,
      }}
      onMouseEnter={(e) => {
        if (!isActive) { e.currentTarget.style.background = NAVY_HOVER; e.currentTarget.style.color = NAVY_TEXT; }
      }}
      onMouseLeave={(e) => {
        if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = NAVY_MUTED; }
      }}
    >
      <Icon size={13} className="w-4 flex-none" />
      <span className="flex-1 truncate">{item.label}</span>
      {extra}
      {count !== undefined && count > 0 && (
        <span
          className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
          style={
            item.id === 'alerts'
              ? { background: '#EE1D52', color: 'white', boxShadow: '0 2px 6px rgba(238,29,82,0.45)' }
              : { background: 'rgba(120, 134, 178, 0.2)', color: NAVY_MUTED }
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}
