/**
 * App-level UI state shared between the shell (App.tsx) and pages.
 *
 * Owned by the live-view components; pages may READ it (e.g. Followers reads
 * `fanFocus` to preselect a fan after "Open full profile") but should not
 * edit this file.
 */
import { create } from 'zustand';

export type Page = 'dashboard' | 'live' | 'followers' | 'gifts' | 'reminders' | 'messages' | 'import' | 'settings';
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

export type StreamNote = {
  id: string;
  ts: number;
  text: string;
  /** uniqueId when the note mentioned @user and was synced to their fan notes */
  syncedTo?: string;
};

const PAGES: Page[] = ['dashboard', 'live', 'followers', 'gifts', 'reminders', 'messages', 'import', 'settings'];

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

let noteCounter = 0;

type UIState = {
  page: Page;
  /** Fan to preselect when navigating to the Followers page (read by pages). */
  fanFocus: string | null;
  setPage: (page: Page) => void;

  /** Sidebar face: flips to the live toolset while on the live page. */
  sidebarMode: SidebarMode;
  /** Tool shown in the live page content area ('feed' = live feed). */
  liveTool: LiveTool;
  /** Navigate to the live page with a specific tool active. */
  openLiveTool: (tool: LiveTool) => void;
  /** "← Back" from the live sidebar: restore main nav and return to dashboard. */
  backToMain: () => void;
  /** Navigate to the Followers page with a fan preselected. */
  openFanProfile: (uniqueId: string) => void;
  clearFanFocus: () => void;

  /** Fan selected in the Messages page's follow-up panel (persists across page switches). */
  messagesFanFocus: string | null;
  setMessagesFanFocus: (uniqueId: string | null) => void;
  /** Navigate to the Messages page with a fan preselected in the follow-up panel. */
  openMessagesFor: (uniqueId: string) => void;

  /** Live feed tab (lifted so e.g. the composer gift button can switch tabs). */
  tab: FeedTab;
  setTab: (tab: FeedTab) => void;
  feedFilter: FeedFilter;
  setFeedFilter: (f: FeedFilter) => void;

  /** Fan Memory panel selection. Manual clicks pin; gift events auto-select when not pinned. */
  fanMemoryId: string | null;
  fanMemoryPinned: boolean;
  focusFanMemory: (uniqueId: string | null, opts?: { auto?: boolean }) => void;

  /** Personal stream notes for the current session (read-only connector → in-memory). */
  streamNotes: StreamNote[];
  addStreamNote: (text: string, syncedTo?: string) => StreamNote;
  clearStreamNotes: () => void;
};

export const useUI = create<UIState>((set, get) => ({
  page: initialPage(),
  fanFocus: null,
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

  openFanProfile: (uniqueId) => set({ page: 'followers', fanFocus: uniqueId, sidebarMode: 'main' }),
  clearFanFocus: () => set({ fanFocus: null }),

  messagesFanFocus: null,
  setMessagesFanFocus: (uniqueId) => set({ messagesFanFocus: uniqueId }),
  openMessagesFor: (uniqueId) => set({ page: 'messages', messagesFanFocus: uniqueId, sidebarMode: 'main' }),

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

  streamNotes: [],
  addStreamNote: (text, syncedTo) => {
    const note: StreamNote = { id: `note-${Date.now()}-${noteCounter++}`, ts: Date.now(), text, syncedTo };
    set((s) => ({ streamNotes: [note, ...s.streamNotes] }));
    return note;
  },
  clearStreamNotes: () => set({ streamNotes: [] }),
}));
