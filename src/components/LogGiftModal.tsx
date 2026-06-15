/** Shared "Log gift" modal — manual gift logging from the Gifts page and the 360 fan profile. */
import { useEffect, useState } from 'react';
import { useAlerts } from '../state/alerts';
import { FieldLabel, inputCls } from './crm';
import { Dialog } from './ui/Dialog';

export function LogGiftModal({
  onClose,
  onLogged,
  fixedFan,
}: {
  onClose: () => void;
  onLogged: () => void;
  /** Pre-fill + lock the fan (used from a fan's own profile). */
  fixedFan?: { uniqueId: string; nickname?: string };
}) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [username, setUsername] = useState(fixedFan?.uniqueId ?? '');
  const [giftName, setGiftName] = useState('');
  const [diamonds, setDiamonds] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [suggestions, setSuggestions] = useState<{ uniqueId: string; label: string }[]>([]);

  useEffect(() => {
    if (fixedFan) return;
    const u = username.replace(/^@/, '').trim();
    if (u.length < 1) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      window.tiktok.fansList({ search: u, pageSize: 6 }).then((r) =>
        setSuggestions(r.data.map((f) => ({ uniqueId: f.uniqueId, label: `${f.displayName || f.nickname} (@${f.uniqueId})` }))),
      ).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [username, fixedFan]);

  const valid = username.replace(/^@/, '').trim() && giftName.trim() && Number(diamonds) > 0;

  const submit = async () => {
    if (!valid) return;
    const at = date ? new Date(`${date}T12:00:00`).getTime() : undefined;
    const res = await window.tiktok.fansLogGift({
      uniqueId: username.replace(/^@/, '').trim(),
      nickname: fixedFan?.nickname,
      giftName: giftName.trim(),
      diamonds: Number(diamonds),
      at,
    });
    if (res.ok) onLogged();
    else pushToast({ title: 'Could not log gift', body: res.error ?? 'Unknown error' });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} ariaLabel="Log gift" width={380}>
        <h2 className="mb-3 text-base font-extrabold">Log gift</h2>
        <div className="space-y-3">
          <div>
            <FieldLabel>Fan *</FieldLabel>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              autoFocus={!fixedFan}
              disabled={!!fixedFan}
              className={`${inputCls} ${fixedFan ? 'opacity-70' : ''}`}
              list="log-gift-fans"
            />
            {!fixedFan && (
              <datalist id="log-gift-fans">
                {suggestions.map((s) => <option key={s.uniqueId} value={s.uniqueId}>{s.label}</option>)}
              </datalist>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Gift name *</FieldLabel>
              <input value={giftName} onChange={(e) => setGiftName(e.target.value)} placeholder="Galaxy" autoFocus={!!fixedFan} className={inputCls} />
            </div>
            <div>
              <FieldLabel>Diamonds *</FieldLabel>
              <input value={diamonds} onChange={(e) => setDiamonds(e.target.value.replace(/[^\d]/g, ''))} placeholder="1000" inputMode="numeric" className={inputCls} />
            </div>
          </div>
          <div>
            <FieldLabel>Date</FieldLabel>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="panel-btn no-drag">Cancel</button>
          <button onClick={submit} disabled={!valid} className="panel-btn panel-btn-primary no-drag">Log gift</button>
        </div>
    </Dialog>
  );
}
