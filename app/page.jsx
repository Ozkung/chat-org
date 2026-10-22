import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { createBoard } from '@/app/actions';
import BoardListItem from '@/components/BoardListItem';
import { prisma } from '@/lib/prisma';

export const metadata = { title: 'My boards · Discussion Canvas' };

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const memberships = await prisma.boardMember.findMany({
    where: { userId },
    orderBy: { lastOpenedAt: 'desc' },
    include: { board: { include: { owner: { select: { name: true } }, _count: { select: { members: true } } } } },
  });

  return (
    <main className="dashboard">
      <header className="dash-header">
        <div className="brand">🧭 Discussion Canvas</div>
        <div className="me">
          {session.user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.user.image} alt="" referrerPolicy="no-referrer" />
          )}
          <span>{session.user.name || session.user.email}</span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/signin' });
            }}
          >
            <button type="submit" className="link-btn">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="dash-card">
        <h2>New board</h2>
        <form action={createBoard} className="share-row">
          <input className="field" name="title" placeholder="e.g. Weekly sync – 22 Oct" maxLength={120} />
          <button type="submit" className="tb-btn primary">
            ＋ Create
          </button>
        </form>
      </section>

      <section className="dash-card">
        <h2>My boards</h2>
        {memberships.length === 0 ? (
          <p className="muted">No boards yet. Create one above, or open a link someone shared with you.</p>
        ) : (
          <ul className="board-list">
            {memberships.map(({ board, role, lastOpenedAt }) => (
              <BoardListItem
                key={board.id}
                roomId={board.roomId}
                title={board.title}
                role={role}
                ownerName={board.ownerId === userId ? 'you' : board.owner?.name || 'someone'}
                memberCount={board._count.members}
                lastOpened={lastOpenedAt.toISOString()}
              />
            ))}
          </ul>
        )}
      </section>
      <p className="muted dash-foot">
        Boards are saved automatically. <Link href="https://github.com/Ozkung/chat-org">Source</Link>
      </p>
    </main>
  );
}
