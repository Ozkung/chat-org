'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { requireOwner } from '@/lib/access';
import { makeRoomId } from '@/lib/board';
import { liveblocks } from '@/lib/liveblocks-server';
import { prisma } from '@/lib/prisma';
import { deleteBoardImages } from '@/lib/storage';

async function requireUserId() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/signin');
  return userId;
}

const cleanTitle = (value) => String(value || '').trim().slice(0, 120) || 'Untitled board';

export async function createBoard(formData) {
  const userId = await requireUserId();
  const roomId = makeRoomId();
  await prisma.board.create({
    data: {
      roomId,
      title: cleanTitle(formData?.get('title')),
      ownerId: userId,
      members: { create: { userId, role: 'OWNER' } },
    },
  });
  redirect(`/b/${roomId}`);
}

export async function renameBoard(roomId, title) {
  const userId = await requireUserId();
  await requireOwner(roomId, userId);
  await prisma.board.update({ where: { roomId }, data: { title: cleanTitle(title) } });
  revalidatePath('/');
}

export async function setLinkAccess(roomId, linkAccess) {
  const userId = await requireUserId();
  if (!['NONE', 'VIEW', 'EDIT'].includes(linkAccess)) throw new Error('Invalid link access');
  await requireOwner(roomId, userId);
  await prisma.board.update({ where: { roomId }, data: { linkAccess } });
}

// Owners delete the board for everyone; other members just remove it from their list.
export async function deleteOrLeaveBoard(roomId) {
  const userId = await requireUserId();
  const board = await prisma.board.findUnique({ where: { roomId } });
  if (!board) return;
  if (board.ownerId === userId) {
    await prisma.board.delete({ where: { id: board.id } });
    await liveblocks()
      .deleteRoom(roomId)
      .catch(() => {}); // room may never have been opened
    await deleteBoardImages(roomId).catch((e) => console.error('Failed to delete board images', e));
  } else {
    await prisma.boardMember.deleteMany({ where: { boardId: board.id, userId } });
  }
  revalidatePath('/');
}
