import 'server-only';
import { Liveblocks } from '@liveblocks/node';

let client;
export function liveblocks() {
  client ??= new Liveblocks({
    secret: process.env.LIVEBLOCKS_SECRET_KEY,
    // Set only for the local `liveblocks dev` server.
    ...(process.env.LIVEBLOCKS_BASE_URL ? { baseUrl: process.env.LIVEBLOCKS_BASE_URL } : {}),
  });
  return client;
}
