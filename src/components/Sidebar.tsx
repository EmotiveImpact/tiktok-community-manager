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
      className="flex h-full min-h-0 w-[200px] flex-none flex-col"
      style={{
        background: 'var(--bg-window)',
        borderRight: '0.5px solid var(--separator)',
        backdropFilter: 'blur(40px) saturate(140%)',
        WebkitBackdropFilter: 'blur(40px) saturate(140%)',
      }}
    >
      {/* Watch Stream button */}
      <div className="flex-none px-2 pt-2.5 pb-1">
        <button
          type="button"
          onClick={onToggleStream}
          disabled={!connected}
          className="no-drag flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: showStream ? 'rgba(255, 69, 58, 0.16)' : 'transparent',
            color: showStream ? 'var(--red)' : 'var(--label)',
            border: showStream ? '0.5px solid rgba(255, 69, 58, 0.3)' : '0.5px solid transparent',
          }}
          onMouseEnter={(e) => {
            if (!showStream && connected) e.currentTarget.style.background = 'var(--fill-thin)';
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
              style={{ background: 'var(--red)', boxShadow: '0 0 6px var(--red)' }}
            />
          )}
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {SECTIONS.map((section) => (
          <div key={section.group} className="mt-2">
            <div
              className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--tertiary-label)' }}
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
                  className="no-drag flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[12px] transition"
                  style={{
                    background: isActive ? 'rgba(10, 132, 255, 0.18)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--label)',
                    fontWeight: isActive ? 600 : 500,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'var(--fill-thin)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span className="w-4 flex-none text-center text-[12px]">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {count !== undefined && count > 0 && (
                    <span
                      className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
                      style={{
                        background: isActive ? 'var(--accent)' : 'var(--fill)',
                        color: isActive ? 'white' : 'var(--secondary-label)',
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
    </aside>
  );
}
