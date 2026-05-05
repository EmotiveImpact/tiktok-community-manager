import { create } from 'zustand';

export type TrackedUser = {
  uniqueId: string;
  nickname: string;
  addedAt: number;
};

type TrackedState = {
  list: TrackedUser[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (uniqueId: string, nickname: string) => Promise<void>;
  remove: (uniqueId: string) => Promise<void>;
  isTracked: (uniqueId: string) => boolean;
};

export const useTracked = create<TrackedState>((set, get) => ({
  list: [],
  loaded: false,

  load: async () => {
    const list = await window.tiktok.trackedList();
    set({ list, loaded: true });
  },

  add: async (uniqueId, nickname) => {
    const handle = uniqueId.replace(/^@/, '').trim();
    if (!handle) return;
    await window.tiktok.trackedAdd({ uniqueId: handle, nickname });
    const list = await window.tiktok.trackedList();
    set({ list });
  },

  remove: async (uniqueId) => {
    await window.tiktok.trackedRemove(uniqueId);
    const list = await window.tiktok.trackedList();
    set({ list });
  },

  isTracked: (uniqueId) => {
    return get().list.some((u) => u.uniqueId === uniqueId);
  },
}));
