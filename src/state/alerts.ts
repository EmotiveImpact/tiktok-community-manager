import { create } from 'zustand';
import type { LiveEvent } from '../types';
import { playGiftSound, playFollowSound, playKeywordSound, playMilestoneSound } from '../lib/sounds';

export type AlertRule = {
  id: string;
  enabled: boolean;
  type: 'keyword' | 'gift_diamonds' | 'gift_name' | 'follower' | 'viewer_threshold';
  value: string;
  label: string;
};

export type AlertToast = {
  id: string;
  ts: number;
  title: string;
  body: string;
  ruleId: string;
};

type AlertState = {
  rules: AlertRule[];
  toasts: AlertToast[];
  history: AlertToast[];
  soundEnabled: boolean;
  autoClip: boolean;
  addRule: (rule: Omit<AlertRule, 'id'>) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  updateRule: (id: string, patch: Partial<Pick<AlertRule, 'value' | 'label'>>) => void;
  toggleSound: () => void;
  toggleAutoClip: () => void;
  dismissToast: (id: string) => void;
  clearHistory: () => void;
  pushToast: (toast: { title: string; body: string; ruleId?: string }) => void;
  checkEvent: (evt: LiveEvent, viewerCount: number) => void;
};

let counter = 0;
const uid = () => `alert-${Date.now()}-${counter++}`;

const TOAST_MAX = 20;
const TOAST_TTL = 8000;
const HISTORY_MAX = 100;

export const useAlerts = create<AlertState>((set, get) => ({
  rules: [],
  toasts: [],
  history: [],
  soundEnabled: true,
  autoClip: false,

  addRule: (rule) =>
    set((s) => ({ rules: [...s.rules, { ...rule, id: uid() }] })),

  removeRule: (id) =>
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),

  toggleRule: (id) =>
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    })),

  updateRule: (id, patch) =>
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
  toggleAutoClip: () => set((s) => ({ autoClip: !s.autoClip })),

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clearHistory: () => set({ history: [] }),

  pushToast: ({ title, body, ruleId }) => {
    const id = uid();
    const toast = { id, ts: Date.now(), title, body, ruleId: ruleId ?? '' };
    set((s) => ({
      toasts: [toast, ...s.toasts].slice(0, TOAST_MAX),
      history: [toast, ...s.history].slice(0, HISTORY_MAX),
    }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_TTL);
    if (typeof document !== 'undefined' && document.hidden && 'Notification' in window) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(title, { body, silent: false });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission();
        }
      } catch { /* ignore */ }
    }
  },

  checkEvent: (evt, viewerCount) => {
    const { rules } = get();
    const active = rules.filter((r) => r.enabled);
    if (active.length === 0) return;

    const newToasts: AlertToast[] = [];

    for (const rule of active) {
      switch (rule.type) {
        case 'keyword': {
          if (evt.type !== 'chat') break;
          const kw = rule.value.toLowerCase();
          if (evt.comment.toLowerCase().includes(kw)) {
            newToasts.push({
              id: uid(),
              ts: Date.now(),
              title: `Keyword: "${rule.value}"`,
              body: `${evt.user.nickname}: ${evt.comment}`,
              ruleId: rule.id,
            });
          }
          break;
        }
        case 'gift_diamonds': {
          if (evt.type !== 'gift') break;
          const threshold = parseInt(rule.value, 10) || 0;
          const total = evt.diamondCount * evt.repeatCount;
          if (total >= threshold) {
            newToasts.push({
              id: uid(),
              ts: Date.now(),
              title: `Big gift! (${total} diamonds)`,
              body: `${evt.user.nickname} sent ${evt.giftName}${evt.repeatCount > 1 ? ` x${evt.repeatCount}` : ''}`,
              ruleId: rule.id,
            });
          }
          break;
        }
        case 'gift_name': {
          if (evt.type !== 'gift') break;
          if (evt.giftName.toLowerCase().includes(rule.value.toLowerCase())) {
            newToasts.push({
              id: uid(),
              ts: Date.now(),
              title: `Gift: ${evt.giftName}`,
              body: `From ${evt.user.nickname}${evt.repeatCount > 1 ? ` x${evt.repeatCount}` : ''}`,
              ruleId: rule.id,
            });
          }
          break;
        }
        case 'follower': {
          if (evt.type !== 'follow') break;
          newToasts.push({
            id: uid(),
            ts: Date.now(),
            title: 'New follower',
            body: evt.user.nickname,
            ruleId: rule.id,
          });
          break;
        }
        case 'viewer_threshold': {
          if (evt.type !== 'roomUser') break;
          const thresh = parseInt(rule.value, 10) || 0;
          if (viewerCount >= thresh) {
            newToasts.push({
              id: uid(),
              ts: Date.now(),
              title: `Viewer milestone: ${viewerCount}`,
              body: `Reached ${thresh}+ viewers`,
              ruleId: rule.id,
            });
          }
          break;
        }
      }
    }

    if (newToasts.length > 0) {
      set((s) => ({
        toasts: [...newToasts, ...s.toasts].slice(0, TOAST_MAX),
        history: [...newToasts, ...s.history].slice(0, HISTORY_MAX),
      }));
      if (get().soundEnabled) {
        const firstRule = active.find((r) => r.id === newToasts[0].ruleId);
        if (firstRule) {
          switch (firstRule.type) {
            case 'gift_diamonds':
            case 'gift_name':
              playGiftSound();
              break;
            case 'follower':
              playFollowSound();
              break;
            case 'keyword':
              playKeywordSound();
              break;
            case 'viewer_threshold':
              playMilestoneSound();
              break;
          }
        }
      }
      for (const t of newToasts) {
        setTimeout(() => {
          get().dismissToast(t.id);
        }, TOAST_TTL);
      }
      if (typeof document !== 'undefined' && document.hidden && 'Notification' in window) {
        try {
          if (Notification.permission === 'granted') {
            for (const t of newToasts.slice(0, 3)) {
              new Notification(t.title, { body: t.body });
            }
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
          }
        } catch { /* ignore */ }
      }
      if (get().autoClip && typeof window !== 'undefined' && (window as any).tiktok?.highlightsCapture) {
        const reason = newToasts[0]?.title ?? 'alert';
        (window as any).tiktok.highlightsCapture(reason).catch(() => {});
      }
    }
  },
}));
