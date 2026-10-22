import 'server-only';
import { prisma } from '@/lib/prisma';

const LINK_ROLE = { EDIT: 'EDITOR', VIEW: 'VIEWER' };

/**
 * Resolves what `userId` may do on the board behind `roomId`.
 * Members keep their role. Anyone else who has the link is added as a member
 * according to the board's link setting, so the board shows up in their list.
 * Returns { board, role } or null (no such board / no access).
 */
export async function resolveBoardAccess(roomId, userId) {
  const board = await prisma.board.findUnique({
    where: { roomId },
    include: { members: { where: { userId } } },
  });
  if (!board) return null;

  const membership = board.members[0];
  if (membership) {
    await prisma.boardMember.update({
      where: { boardId_userId: { boardId: board.id, userId } },
      data: { lastOpenedAt: new Date() },
    });
    return { board, role: membership.role };
  }

  const role = LINK_ROLE[board.linkAccess];
  if (!role) return null;
  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: board.id, userId } },
    update: { lastOpenedAt: new Date() },
    create: { boardId: board.id, userId, role },
  });
  return { board, role };
}

/** Same rules as resolveBoardAccess, but read-only: never adds a membership. Returns a role or null. */
export async function findBoardRole(roomId, userId) {
  const board = await prisma.board.findUnique({
    where: { roomId },
    select: { linkAccess: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!board) return null;
  return board.members[0]?.role ?? LINK_ROLE[board.linkAccess] ?? null;
}

export async function requireOwner(roomId, userId) {
  const board = await prisma.board.findUnique({ where: { roomId } });
  if (!board || board.ownerId !== userId) throw new Error('Only the board owner can do that.');
  return board;
}
