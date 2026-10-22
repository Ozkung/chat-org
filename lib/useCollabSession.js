'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { getMaps, replaceBoardInDoc } from './collab';

/**
 * Joins a peer-to-peer room:
 *  - IndexedDB keeps a local copy (offline + survives reloads, even when nobody else is online)
 *  - CollabProvider syncs over public MQTT relays and direct WebRTC at once (see transports.js)
 *  - Awareness shares presence: name, colour, canvas pointer, Tiptap caret
 *
 * `seedBoard` is only applied to a room this browser just created, so joiners never duplicate content.
 */
export function useCollabSession(roomId, seedBoard, user) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState({ relays: 0, peers: 0 });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId) return undefined;
    let cancelled = false;
    let provider;
    let persistence;
    const doc = new Y.Doc();

    setError(null);
    (async () => {
      const [{ CollabProvider }, { IndexeddbPersistence }] = await Promise.all([
        import('./collabProvider'),
        import('y-indexeddb'),
      ]);
      if (cancelled) return;

      // Local copy. In-app browsers and some private modes block IndexedDB, so never let it hold up joining.
      try {
        persistence = new IndexeddbPersistence(`discussion-canvas:${roomId}`, doc);
        await Promise.race([persistence.whenSynced, new Promise((r) => setTimeout(r, 1500))]);
      } catch (e) {
        console.warn('Local storage unavailable; continuing without an offline copy.', e);
      }
      if (cancelled) return;

      if (seedBoard && getMaps(doc).nodesMap.size === 0) replaceBoardInDoc(doc, seedBoard);

      provider = new CollabProvider(roomId, doc);
      provider.on('status', (next) => setStatus(next));

      setSession({ doc, provider, awareness: provider.awareness, ...getMaps(doc) });
    })().catch((e) => {
      console.error('Could not join board', e);
      if (!cancelled) setError(e?.message || String(e));
    });

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

  const value = useMemo(() => (session ? { ...session, user, status } : null), [session, user, status]);
  return { session: value, error };
}
