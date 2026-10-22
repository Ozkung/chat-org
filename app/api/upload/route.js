import { auth } from '@/auth';
import { findBoardRole } from '@/lib/access';
import { storeImage } from '@/lib/storage';

// Receives one (already resized) image for a board's chat notes.
export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: 'Sign in required' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const room = form?.get('room');
  if (typeof room !== 'string' || !file || typeof file === 'string') {
    return Response.json({ error: 'Missing file or room' }, { status: 400 });
  }

  const role = await findBoardRole(room, userId);
  if (!role || role === 'VIEWER') return Response.json({ error: 'No permission to post on this board' }, { status: 403 });

  try {
    return Response.json({ url: await storeImage(room, file) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
