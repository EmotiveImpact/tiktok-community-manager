/**
 * Renderer-side mirror of the persisted app settings the UI needs everywhere
 * (earnings estimate, community rules, thank-you template).
 *
 * Loaded lazily from window.tiktok.getSettings(); call useSettingsLoad() in a
 * page/component (or useSettings.getState().load()) before relying on values.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { CommunitySettings, EarningsSettings, MyAccount } from '../types';

export const DEFAULT_EARNINGS: EarningsSettings = { enabled: false, ratePer1000: 10, currency: '£' };
export const DEFAULT_COMMUNITY: CommunitySettings = {
  quietDays: 14,
  birthdayWindowDays: 30,
  tiers: { regular: 100, vip: 1000, whale: 10000 },
};
export const DEFAULT_THANK_TEMPLATE =
  'Hey {nickname}! Thank you so much for the {giftName} 💕 You made my stream!';
export const DEFAULT_MY_ACCOUNT: MyAccount = { username: '' };

type SettingsState = {
  loaded: boolean;
  earnings: EarningsSettings;
  community: CommunitySettings;
  thankTemplate: string;
  myAccount: MyAccount;
  load: () => Promise<void>;
  setEarnings: (e: EarningsSettings) => Promise<void>;
  setCommunity: (c: CommunitySettings) => Promise<{ ok: boolean; error?: string }>;
  setThankTemplate: (tpl: string) => Promise<void>;
  setMyAccount: (a: MyAccount) => Promise<MyAccount>;
};

let loadPromise: Promise<void> | null = null;

export const useSettings = create<SettingsState>((set) => ({
  loaded: false,
  earnings: DEFAULT_EARNINGS,
  community: DEFAULT_COMMUNITY,
  thankTemplate: DEFAULT_THANK_TEMPLATE,
  myAccount: DEFAULT_MY_ACCOUNT,

  load: () => {
    if (!loadPromise) {
      loadPromise = window.tiktok
        .getSettings()
        .then((s) => {
          set({
            loaded: true,
            earnings: s.earnings ?? DEFAULT_EARNINGS,
            community: s.community ?? DEFAULT_COMMUNITY,
            thankTemplate: s.thankTemplate || DEFAULT_THANK_TEMPLATE,
            myAccount: s.myAccount ?? DEFAULT_MY_ACCOUNT,
          });
        })
        .catch(() => set({ loaded: true }));
    }
    return loadPromise;
  },

  setEarnings: async (earnings) => {
    set({ earnings });
    await window.tiktok.setEarnings(earnings).catch(() => {});
  },
  setCommunity: async (community) => {
    const res = await window.tiktok.setCommunity(community).catch(() => ({ ok: false, error: 'Save failed' }));
    if (res.ok) set({ community });
    return res;
  },
  setThankTemplate: async (thankTemplate) => {
    set({ thankTemplate });
    await window.tiktok.setThankTemplate(thankTemplate).catch(() => {});
  },
  setMyAccount: async (myAccount) => {
    // Persist; trust the normalized result back from main so the username we
    // store locally matches what main saved (strips '@', lowercases).
    const res = await window.tiktok.setMyAccount(myAccount).catch(() => ({ ok: false as const, myAccount }));
    const next = (res && 'myAccount' in res && res.myAccount) ? res.myAccount : myAccount;
    set({ myAccount: next });
    return next;
  },
}));

/** Convenience hook: subscribes to settings and triggers the initial load. */
export function useSettingsLoad(): SettingsState {
  const state = useSettings();
  useEffect(() => {
    void useSettings.getState().load();
  }, []);
  return state;
}
