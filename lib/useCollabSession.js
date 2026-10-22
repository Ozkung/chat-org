'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { createClient } from '@liveblocks/client';
import { LiveblocksYjsProvider } from '@liveblocks/yjs';
import { getMaps } from './collab';

// One Liveblocks client per tab. The auth endpoint checks board membership before issuing a token.
let client;
function getClient() {
  client ??= createClient({
    authEndpoint: '/api/liveblocks-auth',
    throttle: 40, // presence (cursor) updates, ms
    ...(process.env.NEXT_PUBLIC_LIVEBLOCKS_BASE_URL ? { baseUrl: process.env.NEXT_PUBLIC_LIVEBLOCKS_BASE_URL } : {}),
  });
  return client;
}

/**
 * Joins a board's Liveblocks room:
 *  - LiveblocksYjsProvider syncs the shared Y.Doc (content is stored by Liveblocks)
 *  - Awareness shares presence: name, colour, avatar, canvas pointer, Tiptap caret
 * Resolves once the first full sync from the server has arrived, so the board never flashes empty.
 */
export function useCollabSession(roomId, user) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId) return undefined;
    const doc = new Y.Doc();
    const { room, leave } = getClient().enterRoom(roomId, { initialPresence: {} });
    const provider = new LiveblocksYjsProvider(room, doc);
    let ready = false;

    const markReady = () => {
      if (ready) return;
      ready = true;
      setSession({ doc, room, provider, awareness: provider.awareness, ...getMaps(doc) });
    };
    if (provider.synced) markReady();
    provider.on('sync', (synced) => synced && markReady());

    const unsubStatus = room.subscribe('status', setStatus);
    const unsubError = room.subscribe('error', (err) => {
      // 4001 = not allowed by our auth endpoint (board deleted or link access turned off)
      const code = err?.context?.code ?? err?.code;
      setError(code === 4001 ? 'You no longer have access to this board.' : err?.message || 'Connection error');
    });

    return () => {
      unsubStatus();
      unsubError();
      provider.destroy();
      leave();
      doc.destroy();
      setSession(null);
    };
  }, [roomId]);

  // Publish our identity to everyone in the room. Re-sent once connected: before that, Liveblocks'
  // awareness can't see our own presence and a later field update could drop it.
  const connected = status === 'connected';
  useEffect(() => {
    session?.awareness.setLocalStateField('user', user);
  }, [session, user, connected]);

  const value = useMemo(() => (session ? { ...session, user, status } : null), [session, user, status]);
  return { session: value, error };
}
