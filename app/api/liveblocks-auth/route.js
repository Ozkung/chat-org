import { auth } from '@/auth';
import { resolveBoardAccess } from '@/lib/access';
import { colorForUser } from '@/lib/board';
import { liveblocks } from '@/lib/liveblocks-server';

// Issues a Liveblocks token for one room after checking board membership in Postgres.
export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response('Sign in required', { status: 401 });

  const { room } = await request.json().catch(() => ({}));
  if (typeof room !== 'string') return new Response('Missing room', { status: 400 });

  const access = await resolveBoardAccess(room, userId);
  if (!access) return new Response('No access to this board', { status: 403 });

  const lbSession = liveblocks().prepareSession(userId, {
    userInfo: {
      name: session.user.name || session.user.email || 'Anonymous',
      avatar: session.user.image || undefined,
      color: colorForUser(userId),
    },
  });
  // Viewers can still share presence (cursor, who's online) but cannot change the board.
  lbSession.allow(room, access.role === 'VIEWER' ? lbSession.READ_ACCESS : lbSession.FULL_ACCESS);
  const { status, body } = await lbSession.authorize();
  return new Response(body, { status });
}
