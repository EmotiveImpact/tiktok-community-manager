import { useTracked } from '../state/tracked';
import { useStore } from '../state/store';

export type SidebarPanel =
  | 'live'
  | 'tracked' | 'notes' | 'room' | 'leaderboard' | 'watchlist'
  | 'alerts' | 'mod' | 'transcript' | 'highlights' | 'liker'
  | 'insights' | 'analytics' | 'compare' | 'history' | 'multi';

type Item = { id: SidebarPanel; label: string; icon: string };

const SECTIONS: { group: string; items: Item[] }[] = [
  {
    group: 'Feed',
    items: [
      { id: 'live', label: 'Live Feed', icon: '💬' },
    ],
  },
  {
    group: 'Audience',
    items: [
      { id: 'tracked', label: 'Tracked Users', icon: '★' },
      { id: 'notes', label: 'Fan Notes', icon: '📝' },
      { id: 'room', label: 'Room Members', icon: '👥' },
      { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
      { id: 'watchlist', label: 'Watchlist', icon: '👀' },
    ],
  },
  {
    group: 'Live',
    items: [
      { id: 'alerts', label: 'Alerts', icon: '🔔' },
      { id: 'mod', label: 'Moderation', icon: '🛡️' },
      { id: 'transcript', label: 'Transcript', icon: '🎙️' },
      { id: 'highlights', label: 'Highlight Clips', icon: '🎬' },
      { id: 'liker', label: 'Live Liker', icon: '❤️' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { id: 'insights', label: 'Chat Insights', icon: '📊' },
      { id: 'analytics', label: 'Creator Analytics', icon: '📈' },
      { id: 'compare', label: 'Compare', icon: '⚖️' },
      { id: 'history', label: 'Session History', icon: '🕒' },
      { id: 'multi', label: 'Multi-Room', icon: '🪟' },
    ],
  },
];

type Props = {
  active: SidebarPanel;
  onSelect: (id: SidebarPanel) => void;
  showStream: boolean;
  onToggleStream: () => void;
};

/* Sidebar keeps its navy gradient in both themes (brand mockup). */
const NAVY_TEXT = 'rgba(226, 232, 248, 0.9)';
const NAVY_MUTED = 'rgba(148, 158, 190, 0.85)';
const NAVY_FAINT = 'rgba(120, 130, 165, 0.55)';
const NAVY_HOVER = 'rgba(120, 134, 178, 0.12)';

function LogoMark() {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-3 pt-4">
      {/* TikTok-note glyph in a pink-gradient rounded square */}
      <div
        className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px]"
        style={{ background: 'var(--gradient-pink)', boxShadow: '0 4px 12px rgba(238,29,82,0.4)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white" aria-hidden>
          <path d="M16.6 5.82a4.28 4.28 0 0 1-1.05-2.82H12.4v12.4a2.6 2.6 0 1 1-2.6-2.6c.27 0 .53.04.78.12V9.69a5.83 5.83 0 0 0-.78-.05 5.86 5.86 0 1 0 5.86 5.86V9.93a7.5 7.5 0 0 0 4.34 1.38V8.1a4.33 4.33 0 0 1-3.4-2.28z" />
        </svg>
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-[13px] font-bold" style={{ color: 'white' }}>TikTok</div>
        <div className="text-[10px] font-semibold" style={{ color: NAVY_MUTED }}>Community Manager</div>
      </div>
    </div>
  );
}

export function Sidebar({ active, onSelect, showStream, onToggleStream }: Props) {
  const trackedCount = useTracked((s) => s.list.length);
  const roomCount = useStore((s) => s.roomMembers.size);
  const status = useStore((s) => s.status);
  const connected = status === 'connected';

  const counts: Partial<Record<SidebarPanel, number>> = {
    tracked: trackedCount,
    room: roomCount,
  };

  return (
    <aside
      className="flex h-full min-h-0 w-[210px] flex-none flex-col"
      style={{
        background: 'var(--gradient-sidebar)',
        borderRight: '1px solid rgba(120, 134, 178, 0.14)',
      }}
    >
      <LogoMark />

      {/* Watch Stream button */}
      <div className="flex-none px-2 pb-1">
        <button
          type="button"
          onClick={onToggleStream}
          disabled={!connected}
          className="no-drag flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: showStream ? 'rgba(238, 29, 82, 0.18)' : 'transparent',
            color: showStream ? '#ff5b85' : NAVY_TEXT,
            border: showStream ? '1px solid rgba(238, 29, 82, 0.35)' : '1px solid transparent',
          }}
          onMouseEnter={(e) => {
            if (!showStream && connected) e.currentTarget.style.background = NAVY_HOVER;
          }}
          onMouseLeave={(e) => {
            if (!showStream) e.currentTarget.style.background = 'transparent';
          }}
        >
          <span className="text-[14px]">▶︎</span>
          <span className="flex-1">Watch Stream</span>
          {showStream && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: '#ee1d52', boxShadow: '0 0 6px #ee1d52' }}
            />
          )}
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {SECTIONS.map((section) => (
          <div key={section.group} className="mt-2">
            <div
              className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: NAVY_FAINT }}
            >
              {section.group}
            </div>
            {section.items.map((item) => {
              const isActive = active === item.id;
              const count = counts[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="no-drag mb-0.5 flex w-full items-center gap-2 rounded-full px-2.5 py-[5px] text-left text-[12px] transition"
                  style={{
                    background: isActive ? 'var(--gradient-pink)' : 'transparent',
                    color: isActive ? 'white' : NAVY_MUTED,
                    fontWeight: isActive ? 700 : 500,
                    boxShadow: isActive ? '0 4px 12px rgba(238, 29, 82, 0.35)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = NAVY_HOVER;
                      e.currentTarget.style.color = NAVY_TEXT;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = NAVY_MUTED;
                    }
                  }}
                >
                  <span className="w-4 flex-none text-center text-[12px]">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {count !== undefined && count > 0 && (
                    <span
                      className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
                      style={{
                        background: isActive ? 'rgba(255,255,255,0.25)' : 'rgba(120, 134, 178, 0.2)',
                        color: isActive ? 'white' : NAVY_MUTED,
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Mission mini-card */}
      <div className="flex-none p-2.5">
        <div
          className="flex items-center gap-2.5 rounded-[14px] p-2.5"
          style={{
            background: 'rgba(120, 134, 178, 0.08)',
            border: '1px solid rgba(120, 134, 178, 0.14)',
          }}
        >
          <img src="./assets/png/icon_heart_3d.png" alt="" className="h-9 w-9 flex-none object-contain" draggable={false} />
          <div className="min-w-0 leading-snug">
            <div className="text-[11px] font-bold" style={{ color: 'white' }}>Never forget your people.</div>
            <div className="text-[10px]" style={{ color: NAVY_MUTED }}>They support you, we help you remember.</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
