'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { getMaps, replaceBoardInDoc } from './collab';

/**
 * Joins a peer-to-peer room:
 *  - IndexedDB keeps a local copy (offline + survives reloads, even when nobody else is online)
 *  - WebRTC syncs with peers, found through public Nostr relays (see p2pProvider.js)
 *  - Awareness shares presence: name, colour, canvas pointer, Tiptap caret
 *
 * `seedBoard` is only applied to a room this browser just created, so joiners never duplicate content.
 */
export function useCollabSession(roomId, seedBoard, user) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState({ relays: 0, peers: 0 });

  useEffect(() => {
    if (!roomId) return undefined;
    let cancelled = false;
    let provider;
    let persistence;
    const doc = new Y.Doc();

    (async () => {
      const [{ TrysteroProvider }, { IndexeddbPersistence }] = await Promise.all([
        import('./p2pProvider'),
        import('y-indexeddb'),
      ]);
      if (cancelled) return;

      const roomName = `discussion-canvas:${roomId}`;
      persistence = new IndexeddbPersistence(roomName, doc);
      await persistence.whenSynced;
      if (cancelled) return;

      if (seedBoard && getMaps(doc).nodesMap.size === 0) replaceBoardInDoc(doc, seedBoard);

      provider = new TrysteroProvider(roomName, doc, { password: roomId });
      provider.on('status', ({ relays }) => setStatus((s) => (s.relays === relays ? s : { ...s, relays })));
      provider.on('peers', ({ peers }) => setStatus((s) => ({ ...s, peers })));

      setSession({ doc, provider, awareness: provider.awareness, ...getMaps(doc) });
    })();

    return () => {
      cancelled = true;
      setSession(null);
      provider?.destroy();
      persistence?.destroy();
      doc.destroy();
    };
    // seedBoard is intentionally read once per room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Publish our identity to everyone in the room.
  useEffect(() => {
    session?.awareness.setLocalStateField('user', user);
  }, [session, user]);

  return useMemo(() => (session ? { ...session, user, status } : null), [session, user, status]);
}
