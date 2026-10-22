import { auth } from '@/auth';
import { findBoardRole } from '@/lib/access';
import { readImage } from '@/lib/storage';

// Streams a stored image to signed-in members of the board it belongs to.
export async function GET(_request, { params }) {
  const segments = (await params).path;
  // Expected shape: boards/<roomId>/<file>; reject anything else (incl. traversal).
  if (segments.length !== 3 || segments[0] !== 'boards' || segments.some((s) => !/^[\w.-]+$/.test(s) || s.startsWith('.'))) {
    return new Response('Not found', { status: 404 });
  }
  const session = await auth();
  if (!session?.user?.id) return new Response('Sign in required', { status: 401 });
  if (!(await findBoardRole(segments[1], session.user.id))) return new Response('Forbidden', { status: 403 });

  const file = await readImage(segments.join('/'));
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(file.body, {
    headers: {
      'Content-Type': file.contentType,
      // File names are random UUIDs and never change; cache only in the viewer's browser.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
