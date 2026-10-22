'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { deleteOrLeaveBoard } from '@/app/actions';

const ROLE_LABEL = { OWNER: 'Owner', EDITOR: 'Can edit', VIEWER: 'View only' };

export default function BoardListItem({ roomId, title, role, ownerName, memberCount, lastOpened }) {
  const [pending, startTransition] = useTransition();
  const isOwner = role === 'OWNER';

  const remove = () => {
    const question = isOwner
      ? `Delete "${title}" for everyone? This cannot be undone.`
      : `Remove "${title}" from your list? You can rejoin with the link if it's still shared.`;
    if (window.confirm(question)) startTransition(() => deleteOrLeaveBoard(roomId));
  };

  return (
    <li className={`board-item ${pending ? 'pending' : ''}`}>
      <Link href={`/b/${roomId}`} className="board-link">
        <strong>{title}</strong>
        <span className="muted">
          {ROLE_LABEL[role]} · by {ownerName} · {memberCount} member{memberCount === 1 ? '' : 's'} · opened{' '}
          {new Date(lastOpened).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </Link>
      <button type="button" className="link-btn danger-text" onClick={remove} disabled={pending}>
        {isOwner ? 'Delete' : 'Leave'}
      </button>
    </li>
  );
}
