import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import BoardCanvas from '@/components/BoardCanvas';
import { resolveBoardAccess } from '@/lib/access';
import { colorForUser } from '@/lib/board';

export const metadata = { title: 'Board · Discussion Canvas', robots: { index: false } };

export default async function BoardPage({ params }) {
  const { roomId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/signin?callbackUrl=${encodeURIComponent(`/b/${roomId}`)}`);

  const access = await resolveBoardAccess(roomId, session.user.id);
  if (!access) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">🔒</div>
          <h1>No access</h1>
          <p className="muted">This board doesn&apos;t exist, or its owner hasn&apos;t shared it with you.</p>
          <Link href="/" className="tb-btn primary">
            Go to my boards
          </Link>
        </div>
      </main>
    );
  }

  const { board, role } = access;
  const userId = session.user.id;
  return (
    <BoardCanvas
      board={{
        roomId,
        title: board.title,
        role,
        isOwner: board.ownerId === userId,
        linkAccess: board.linkAccess,
      }}
      user={{
        id: userId,
        name: session.user.name || session.user.email || 'Anonymous',
        image: session.user.image || null,
        color: colorForUser(userId),
      }}
    />
  );
}
