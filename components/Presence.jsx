'use client';

import { useEffect, useState } from 'react';
import { ViewportPortal, useStore } from '@xyflow/react';
import { initials } from '@/lib/board';

// Live list of awareness states: [{ clientId, user, pointer, isSelf }]
export function useAwarenessStates(awareness) {
  const [states, setStates] = useState([]);
  useEffect(() => {
    if (!awareness) return undefined;
    const update = () =>
      setStates(
        [...awareness.getStates().entries()]
          .filter(([, s]) => s.user)
          .map(([clientId, s]) => ({ clientId, ...s, isSelf: clientId === awareness.clientID })),
      );
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness]);
  return states;
}

// Other people's mouse pointers, drawn in flow coordinates so they track pan/zoom.
export function RemoteCursors({ awareness }) {
  const states = useAwarenessStates(awareness);
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

export function OnlineUsers({ awareness, status }) {
  const states = useAwarenessStates(awareness);
  const people = [...states].sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : 0));
  const live = status.signaling || status.peers > 0;
  const title = live
    ? `${people.length} in this room · ${status.peers} direct connection${status.peers === 1 ? '' : 's'}`
    : 'Not connected to the signaling server — edits are saved locally and sync when it reconnects';
  return (
    <div className="online" title={title}>
      <span className={`dot ${live ? 'live' : ''}`} />
      <div className="avatars">
        {people.slice(0, 6).map((s) => (
          <div
            key={s.clientId}
            className={`avatar ${s.isSelf ? 'self' : ''}`}
            style={{ background: s.user.color }}
            title={s.isSelf ? `${s.user.name} (you)` : s.user.name}
          >
            {initials(s.user.name)}
          </div>
        ))}
        {people.length > 6 && <div className="avatar more">+{people.length - 6}</div>}
      </div>
    </div>
  );
}
