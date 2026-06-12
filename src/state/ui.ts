/**
 * App-level UI state shared between the shell (App.tsx) and pages.
 *
 * Owned by the live-view components; pages may READ it (e.g. Followers reads
 * `fanFocus` to preselect a fan after "Open full profile") but should not
 * edit this file.
 */
import { create } from 'zustand';

export type Page = 'dashboard' | 'live' | 'followers' | 'gifts' | 'reminders' | 'import' | 'settings';
export type FeedTab = 'comments' | 'gifts' | 'questions' | 'top' | 'all';
export type FeedFilter = 'all' | 'followers' | 'subs' | 'mods' | 'gifters';

export type StreamNote = {
  id: string;
  ts: number;
  text: string;
  /** uniqueId when the note mentioned @user and was synced to their fan notes */
  syncedTo?: string;
};

const PAGES: Page[] = ['dashboard', 'live', 'followers', 'gifts', 'reminders', 'import', 'settings'];

function initialPage(): Page {
  try {
    const p = new URLSearchParams(window.location.search).get('page');
    return PAGES.includes(p as Page) ? (p as Page) : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

let noteCounter = 0;

type UIState = {
  page: Page;
  /** Fan to preselect when navigating to the Followers page (read by pages). */
  fanFocus: string | null;
  setPage: (page: Page) => void;
  /** Navigate to the Followers page with a fan preselected. */
  openFanProfile: (uniqueId: string) => void;
  clearFanFocus: () => void;

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
  setPage: (page) => set({ page }),
  openFanProfile: (uniqueId) => set({ page: 'followers', fanFocus: uniqueId }),
  clearFanFocus: () => set({ fanFocus: null }),

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
