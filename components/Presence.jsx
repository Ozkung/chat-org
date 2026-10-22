'use client';

import { useEffect, useState } from 'react';
import { ViewportPortal, useStore } from '@xyflow/react';
import { initials } from '@/lib/board';

// Live list of awareness states: [{ clientId, user, pointer, isSelf }]
export function useAwarenessStates(awareness, room) {
  const [states, setStates] = useState([]);
  useEffect(() => {
    if (!awareness) return undefined;
    const update = () =>
      setStates(
        [...awareness.getStates().entries()]
          .filter(([, s]) => s.user)
          .map(([clientId, s]) => ({ clientId, ...s, isSelf: clientId === awareness.doc.clientID })),
      );
    update();
    // Liveblocks' awareness emits 'change' for others only; our own state changes (and becomes
    // readable once connected) through the room's presence and status events.
    awareness.on('change', update);
    const unsubs = room ? [room.subscribe('my-presence', update), room.subscribe('status', update)] : [];
    return () => {
      awareness.off('change', update);
      unsubs.forEach((u) => u());
    };
  }, [awareness, room]);
  return states;
}

// Other people's mouse pointers, drawn in flow coordinates so they track pan/zoom.
export function RemoteCursors({ awareness }) {
  const states = useAwarenessStates(awareness); // only others' pointers matter here
  const zoom = useStore((s) => s.transform[2]);
  return (
    <ViewportPortal>
      {states
        .filter((s) => !s.isSelf && s.pointer)
        .map((s) => (
          <div
            key={s.clientId}
            className="remote-cursor"
            style={{ transform: `translate(${s.pointer.x}px, ${s.pointer.y}px) scale(${1 / zoom})` }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M2 1l13 7.5-6 1.2L6.3 16z" fill={s.user.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span style={{ background: s.user.color }}>{s.user.name}</span>
          </div>
        ))}
    </ViewportPortal>
  );
}

const STATUS_LABEL = {
  connected: 'Live',
  connecting: 'Connecting…',
  initial: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline — changes sync when back online',
};

export function OnlineUsers({ awareness, room, status }) {
  const states = useAwarenessStates(awareness, room);
  const people = [...states].sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : 0));
  const live = status === 'connected';
  return (
    <div className="online" title={`${people.length} in this board`}>
      <span className={`dot ${live ? 'live' : ''}`} />
      <div className="avatars">
        {people.slice(0, 6).map((s) => (
          <div
            key={s.clientId}
            className={`avatar ${s.isSelf ? 'self' : ''}`}
            style={{ background: s.user.color }}
            title={s.isSelf ? `${s.user.name} (you)` : s.user.name}
          >
            {s.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.user.image} alt="" referrerPolicy="no-referrer" />
            ) : (
              initials(s.user.name)
            )}
          </div>
        ))}
        {people.length > 6 && <div className="avatar more">+{people.length - 6}</div>}
      </div>
      <span className="conn-text">{STATUS_LABEL[status] ?? status}</span>
    </div>
  );
}
