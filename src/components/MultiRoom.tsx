import { useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, LiveEvent, RoomInfo } from '../types';
import { formatNumber } from '../lib/format';
import { PanelHeader, PanelShell } from './PanelHeader';

const USERNAME_COLORS = [
  'text-like-400', 'text-cyan-400', 'text-purple-400', 'text-emerald-300',
  'text-amber-300', 'text-orange-400', 'text-cyan-300', 'text-rose-400',
];
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
}

type RoomState = {
  username: string;
  status: ConnectionStatus;
  error?: string;
  roomInfo: RoomInfo | null;
  viewerCount: number;
  totalLikes: number;
  totalDiamonds: number;
  comments: { user: string; text: string; ts: number }[];
};

export function MultiRoom({ onClose }: { onClose: () => void }) {
  const [rooms, setRooms] = useState<Map<string, RoomState>>(new Map());
  const [input, setInput] = useState('');
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  useEffect(() => {
    const offStatus = window.tiktok.onMultiStatus(({ username, status, error }) => {
      setRooms((prev) => {
        const next = new Map(prev);
        const r = next.get(username);
        if (r) {
          next.set(username, { ...r, status: status as ConnectionStatus, error });
        }
        return next;
      });
    });

    const offEvent = window.tiktok.onMultiEvent(({ username, evt }) => {
      setRooms((prev) => {
        const next = new Map(prev);
        const r = next.get(username);
        if (!r) return prev;
        const updated = { ...r };
        const e = evt as LiveEvent;
        if (e.type === 'roomInfo') {
          updated.roomInfo = e.info;
        } else if (e.type === 'roomUser') {
          updated.viewerCount = e.viewerCount;
        } else if (e.type === 'like') {
          updated.totalLikes += e.likeCount || 1;
        } else if (e.type === 'gift') {
          updated.totalDiamonds += (e.diamondCount || 0) * (e.repeatCount || 1);
        } else if (e.type === 'chat') {
          updated.comments = [
            { user: e.user.nickname, text: e.comment, ts: e.ts },
            ...r.comments,
          ].slice(0, 50);
        }
        next.set(username, updated);
        return next;
      });
    });

    return () => {
      offStatus();
      offEvent();
    };
  }, []);

  const addRoom = async () => {
    const handle = input.trim().replace(/^@/, '');
    if (!handle || rooms.has(handle)) return;
    setInput('');
    const newRoom: RoomState = {
      username: handle,
      status: 'connecting',
      roomInfo: null,
      viewerCount: 0,
      totalLikes: 0,
      totalDiamonds: 0,
      comments: [],
    };
    setRooms((prev) => new Map(prev).set(handle, newRoom));
    const res = await window.tiktok.multiConnect(handle);
    if (!res.ok) {
      setRooms((prev) => {
        const next = new Map(prev);
        const r = next.get(handle);
        if (r) next.set(handle, { ...r, status: 'error', error: res.error });
        return next;
      });
    }
  };

  const removeRoom = async (username: string) => {
    await window.tiktok.multiDisconnect(username);
    setRooms((prev) => {
      const next = new Map(prev);
      next.delete(username);
      return next;
    });
  };

  const roomList = [...rooms.values()];

  return (
    <PanelShell>
      <PanelHeader
        title="Multi-Room Monitor"
        badge={roomList.length}
        onClose={onClose}
        actions={
          <button
            onClick={async () => {
              await window.tiktok.multiDisconnectAll();
              setRooms(new Map());
            }}
            className="panel-btn panel-btn-secondary"
          >
            Disconnect all
          </button>
        }
      >
        <div className="flex items-center gap-1.5">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-xs text-zinc-500">@</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addRoom(); }}
              placeholder="Add username…"
              className="h-7 w-40 rounded-md border border-zinc-700 bg-zinc-900 pl-6 pr-2.5 text-xs text-zinc-100 outline-none focus:border-like-500/60"
            />
          </div>
          <button
            onClick={addRoom}
            disabled={!input.trim()}
            className="panel-btn panel-btn-primary"
          >
            Connect
          </button>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto p-4">
        {roomList.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Add usernames above to monitor multiple lives simultaneously.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roomList.map((room) => (
              <RoomCard key={room.username} room={room} onRemove={() => removeRoom(room.username)} />
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color =
    status === 'connected' ? 'bg-like-500 animate-pulse' :
    status === 'connecting' || status === 'reconnecting' ? 'bg-amber-400 animate-pulse' :
    status === 'error' ? 'bg-rose-400' : 'bg-zinc-600';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function RoomCard({ room, onRemove }: { room: RoomState; onRemove: () => void }) {
  return (
    <div className="glass flex flex-col overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-zinc-800/40 px-3 py-2.5">
        <StatusDot status={room.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">
            {room.roomInfo?.hostNickname ?? room.username}
          </div>
          <div className="truncate text-[10px] text-zinc-500">@{room.username}</div>
        </div>
        <button
          onClick={onRemove}
          className="rounded-md px-2 py-0.5 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-400"
        >
          Disconnect
        </button>
      </div>

      {room.error && (
        <div className="px-3 py-1 text-[10px] text-rose-400 truncate">{room.error}</div>
      )}

      {room.roomInfo?.title && (
        <div className="px-3 pt-1 truncate text-xs text-zinc-400">{room.roomInfo.title}</div>
      )}

      <div className="grid grid-cols-3 gap-1 px-3 py-2.5">
        <MiniStat label="Viewers" value={formatNumber(room.viewerCount)} accent="text-zinc-100" />
        <MiniStat label="Likes" value={formatNumber(room.totalLikes)} accent="text-like-400" />
        <MiniStat label="Diamonds" value={formatNumber(room.totalDiamonds)} accent="text-amber-300" />
      </div>

      <div className="max-h-40 flex-1 overflow-y-auto border-t border-zinc-800/40 px-3 py-1">
        {room.comments.length === 0 ? (
          <div className="py-2 text-center text-[10px] text-zinc-600">
            {room.status === 'connected' ? 'Waiting for comments…' : ''}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {room.comments.slice(0, 15).map((c, i) => (
              <li key={i} className="text-[11px]">
                <span className={`font-semibold ${colorFor(c.user)}`}>{c.user}</span>{' '}
                <span className="text-zinc-300">{c.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-center">
      <div className={`text-sm font-bold tabular-nums ${accent ?? 'text-zinc-200'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
