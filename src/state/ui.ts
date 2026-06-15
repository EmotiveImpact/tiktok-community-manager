/**
 * App-level UI state shared between the shell (App.tsx) and pages.
 *
 * Owned by the live-view components; pages may READ it (e.g. Followers reads
 * `fanFocus` to preselect a fan after "Open full profile") but should not
 * edit this file.
 */
import { create } from 'zustand';

export type Page = 'dashboard' | 'live' | 'followers' | 'gifts' | 'reminders' | 'messages' | 'import' | 'settings' | 'fan';
export type FeedTab = 'comments' | 'gifts' | 'questions' | 'top' | 'all';

/** Which face the sidebar shows: main app nav, or the live toolset. */
export type SidebarMode = 'main' | 'live';
/** The tool rendered in the live page's content area ('feed' = the live feed itself). */
export type LiveTool =
  | 'feed'
  | 'tracked' | 'notes' | 'room' | 'leaderboard' | 'watchlist'
  | 'alerts' | 'mod' | 'transcript' | 'highlights' | 'liker'
  | 'insights' | 'analytics' | 'compare' | 'history' | 'multiroom';

const LIVE_TOOLS: LiveTool[] = [
  'feed', 'tracked', 'notes', 'room', 'leaderboard', 'watchlist',
  'alerts', 'mod', 'transcript', 'highlights', 'liker',
  'insights', 'analytics', 'compare', 'history', 'multiroom',
];
export type FeedFilter = 'all' | 'followers' | 'subs' | 'mods' | 'gifters';

const PAGES: Page[] =['dashboard', 'live', 'followers', 'gifts', 'reminders', 'messages', 'import', 'settings', 'fan'];

function initialPage(): Page {
  try {
    const p = new URLSearchParams(window.location.search).get('page');
    return PAGES.includes(p as Page) ? (p as Page) : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

function initialTool(): LiveTool {
  try {
    const t = new URLSearchParams(window.location.search).get('tool');
    return LIVE_TOOLS.includes(t as LiveTool) ? (t as LiveTool) : 'feed';
  } catch {
    return 'feed';
  }
}

type UIState = {
  page: Page;
  /**
   * Fan whose full 360 profile is open (read by the FanProfile page and, for
   * back-compat, by the Followers list to preselect a row).
   */
  fanFocus: string | null;
  /** Page to return to when the fan profile's "← Back" is pressed. */
  fanReturnTo: Page;
  setPage: (page: Page) => void;

  /** Sidebar face: flips to the live toolset while on the live page. */
  sidebarMode: SidebarMode;
  /** Tool shown in the live page content area ('feed' = live feed). */
  liveTool: LiveTool;
  /** Navigate to the live page with a specific tool active. */
  openLiveTool: (tool: LiveTool) => void;
  /** "← Back" from the live sidebar: restore main nav and return to dashboard. */
  backToMain: () => void;
  /** Open a fan's full 360 profile page (remembers where we came from). */
  openFanProfile: (uniqueId: string) => void;
  /** "← Back" from the fan profile: return to the page we opened it from. */
  closeFanProfile: () => void;
  clearFanFocus: () => void;

  /**
   * ── Universal Fan PEEK drawer ────────────────────────────────────────────
   * A GLOBAL right-side slide-over that previews ANY fan from ANY page WITHOUT
   * changing `page` (so the underlying page stays put). Rendered once at the
   * App root by <FanPeek/>. Escalate to the full 360 with `openFanProfile`.
   *
   * Contract for follow-up agents:
   *   peekFanId            → the @uniqueId currently peeked, or null when closed.
   *   openFanPeek(uniqueId)→ open/replace the peek for this fan (strips a leading
   *                          '@' and trims). Does NOT touch `page`.
   *   closeFanPeek()       → close the drawer (peekFanId → null).
   */
  peekFanId: string | null;
  /** Open the global Fan Peek drawer for a fan (leaves `page` unchanged). */
  openFanPeek: (uniqueId: string) => void;
  /** Close the global Fan Peek drawer. */
  closeFanPeek: () => void;

  /**
   * ── Global ⌘K command palette ────────────────────────────────────────────
   * Open-state lifted here (was App-local) so ANY surface and the global ⌘K
   * handler can toggle it. <CommandPalette/> is rendered globally driven by
   * `commandOpen`.
   */
  commandOpen: boolean;
  /** Open/close (or toggle, via updater fn) the global command palette. */
  setCommandOpen: (v: boolean | ((prev: boolean) => boolean)) => void;

  /** Fan selected in the Messages page's follow-up panel (persists across page switches). */
  messagesFanFocus: string | null;
  setMessagesFanFocus: (uniqueId: string | null) => void;
  /** Navigate to the Messages page with a fan preselected in the follow-up panel. */
  openMessagesFor: (uniqueId: string) => void;

  /**
   * Persistent stream player. `showStream` lives here (not in App-local state)
   * so the single StreamPlayer instance survives page navigation — letting the
   * live audio keep playing while the user browses the CRM. `playerMinimized`
   * forces the floating mini "now playing" widget even while on the live page.
   */
  showStream: boolean;
  setShowStream: (v: boolean | ((prev: boolean) => boolean)) => void;
  playerMinimized: boolean;
  setPlayerMinimized: (v: boolean | ((prev: boolean) => boolean)) => void;

  /** Live feed tab (lifted so e.g. the composer gift button can switch tabs). */
  tab: FeedTab;
  setTab: (tab: FeedTab) => void;
  feedFilter: FeedFilter;
  setFeedFilter: (f: FeedFilter) => void;

  /** Fan Memory panel selection. Manual clicks pin; gift events auto-select when not pinned. */
  fanMemoryId: string | null;
  fanMemoryPinned: boolean;
  focusFanMemory: (uniqueId: string | null, opts?: { auto?: boolean }) => void;
};

/** Seed fanFocus from ?fan= so the `?page=fan&fan=…` deep-link renders the profile. */
function initialFanFocus(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('fan');
    return q ? q.replace(/^@/, '').trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Seed the Fan Peek from `?peek=<uniqueId>` — a deep-link / screenshot hook so
 * the global drawer can be opened over any page without a ⌘K keystroke.
 */
function initialPeekFan(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('peek');
    return q ? q.replace(/^@/, '').trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Seed the command palette open from `?cmdk=1` — a screenshot/dev hook since
 * ⌘K can't be sent headlessly.
 */
function initialCommandOpen(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('cmdk') === '1';
  } catch {
    return false;
  }
}

export const useUI = create<UIState>((set, get) => ({
  page: initialPage(),
  fanFocus: initialFanFocus(),
  fanReturnTo: 'followers',
  setPage: (page) =>
    set((s) => ({
      page,
      // Entering Live flips the sidebar to the live toolset (starting on the
      // feed); navigating to any main page restores the main sidebar.
      sidebarMode: page === 'live' ? 'live' : 'main',
      liveTool: page === 'live' && s.page !== 'live' ? 'feed' : s.liveTool,
    })),

  sidebarMode: initialPage() === 'live' ? 'live' : 'main',
  liveTool: initialTool(),
  openLiveTool: (tool) => set({ page: 'live', sidebarMode: 'live', liveTool: tool }),
  backToMain: () => set({ sidebarMode: 'main', page: 'dashboard', liveTool: 'feed' }),

  openFanProfile: (uniqueId) =>
    set((s) => ({
      page: 'fan',
      fanFocus: uniqueId.replace(/^@/, '').trim(),
      // Remember where to land on "← Back" (don't stack fan→fan).
      fanReturnTo: s.page === 'fan' ? s.fanReturnTo : s.page,
      sidebarMode: 'main',
      // Escalating to the full 360 always dismisses the lightweight peek.
      peekFanId: null,
    })),
  closeFanProfile: () => set((s) => ({ page: s.fanReturnTo, fanFocus: null, sidebarMode: 'main' })),
  clearFanFocus: () => set({ fanFocus: null }),

  // ── Global Fan PEEK drawer ─────────────────────────────────────────────
  peekFanId: initialPeekFan(),
  openFanPeek: (uniqueId) => {
    const id = uniqueId.replace(/^@/, '').trim();
    if (id) set({ peekFanId: id });
  },
  closeFanPeek: () => set({ peekFanId: null }),

  // ── Global ⌘K command palette ──────────────────────────────────────────
  commandOpen: initialCommandOpen(),
  setCommandOpen: (v) =>
    set((s) => ({ commandOpen: typeof v === 'function' ? v(s.commandOpen) : v })),

  messagesFanFocus: null,
  setMessagesFanFocus: (uniqueId) => set({ messagesFanFocus: uniqueId }),
  openMessagesFor: (uniqueId) => set({ page: 'messages', messagesFanFocus: uniqueId, sidebarMode: 'main' }),

  showStream: false,
  setShowStream: (v) =>
    set((s) => ({ showStream: typeof v === 'function' ? v(s.showStream) : v })),
  playerMinimized: false,
  setPlayerMinimized: (v) =>
    set((s) => ({ playerMinimized: typeof v === 'function' ? v(s.playerMinimized) : v })),

  tab: 'comments',
  setTab: (tab) => set({ tab }),
  feedFilter: 'all',
  setFeedFilter: (feedFilter) => set({ feedFilter }),

  fanMemoryId: null,
  fanMemoryPinned: false,
  focusFanMemory: (uniqueId, opts) => {
    if (opts?.auto) {
      if (get().fanMemoryPinned) return; // don't steal a manually-selected fan
      set({ fanMemoryId: uniqueId });
    } else {
      set({ fanMemoryId: uniqueId, fanMemoryPinned: uniqueId !== null });
    }
  },
}));
