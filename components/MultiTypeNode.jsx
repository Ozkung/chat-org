'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import dynamic from 'next/dynamic';
import { NODE_TYPES, initials, makeId } from '@/lib/board';
import { useCollab, useYArray, useYMapValue } from '@/lib/collab';
import CollabText from './CollabText';

// Tiptap touches the DOM, so load it client-only.
const TiptapEditor = dynamic(() => import('./TiptapEditor'), {
  ssr: false,
  loading: () => <div className="tiptap-wrapper tiptap-loading">Loading editor…</div>,
});

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Content renderers (one per type) ---------- */

function TextContent({ ytext }) {
  return (
    <CollabText
      ytext={ytext}
      multiline
      className="field textarea nodrag nowheel"
      rows={5}
      placeholder="Quick notes…"
    />
  );
}

function ImageContent({ ytext }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | ok | error
  const src = url.trim();

  useEffect(() => {
    setStatus(src ? 'loading' : 'idle');
  }, [src]);

  return (
    <div className="image-content">
      <CollabText
        ytext={ytext}
        onValue={setUrl}
        className="field nodrag"
        type="url"
        placeholder="https://example.com/image.png"
      />
      <div className="image-preview">
        {status === 'idle' && <span className="muted">Paste an image URL to preview</span>}
        {src && status !== 'error' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt="Preview"
            draggable={false}
            style={{ display: status === 'ok' ? 'block' : 'none' }}
            onLoad={() => setStatus('ok')}
            onError={() => setStatus('error')}
          />
        )}
        {status === 'loading' && <span className="muted">Loading preview…</span>}
        {status === 'error' && <span className="error-text">⚠️ Could not load image</span>}
      </div>
    </div>
  );
}

function JsonContent({ ytext }) {
  const [value, setValue] = useState('');
  const error = useMemo(() => {
    if (!value.trim()) return null;
    try {
      JSON.parse(value);
      return null;
    } catch (e) {
      return e.message;
    }
  }, [value]);

  const format = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(ytext.toString()), null, 2);
      ytext.doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, formatted);
      });
    } catch {
      /* keep as-is when invalid */
    }
  };

  return (
    <div>
      <CollabText
        ytext={ytext}
        multiline
        onValue={setValue}
        className={`field textarea mono nodrag nowheel ${error ? 'invalid' : ''}`}
        rows={7}
        spellCheck={false}
      />
      <div className="json-footer">
        <span className={error ? 'error-text' : 'ok-text'}>{error ? `✖ ${error}` : '✔ Valid JSON'}</span>
        <button type="button" className="link-btn nodrag" onClick={format} disabled={!!error}>
          Format
        </button>
      </div>
    </div>
  );
}

/* ---------- Notes / discussion section ---------- */

function NotesSection({ ynotes }) {
  const { user } = useCollab();
  const notes = useYArray(ynotes);
  const [open, setOpen] = useState(false); // per-viewer UI state, not shared
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, notes.length]);

  const submit = (e) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message) return;
    ynotes.push([
      { id: makeId('note'), author: user.name, color: user.color, message, createdAt: new Date().toISOString() },
    ]);
    setDraft('');
    setOpen(true);
  };

  const remove = (noteId) => {
    const index = ynotes.toArray().findIndex((n) => n.id === noteId);
    if (index >= 0) ynotes.delete(index, 1);
  };

  return (
    <div className="notes">
      <button type="button" className="notes-toggle nodrag" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>💬 Notes</span>
        <span className="badge">{notes.length}</span>
        <span className={`chevron ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="notes-body">
          <div className="notes-list nowheel" ref={listRef}>
            {notes.length === 0 && <div className="muted notes-empty">No notes yet — start the discussion.</div>}
            {notes.map((n) => (
              <div key={n.id} className="note">
                <div className="avatar" title={n.author} style={n.color ? { background: n.color } : undefined}>
                  {initials(n.author)}
                </div>
                <div className="note-main">
                  <div className="note-meta">
                    <strong>{n.author}</strong>
                    <span className="muted">{formatTime(n.createdAt)}</span>
                    <button type="button" className="note-delete nodrag" title="Delete note" onClick={() => remove(n.id)}>
                      ✕
                    </button>
                  </div>
                  <div className="note-message">{n.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form className="note-form" onSubmit={submit}>
        <input
          className="field nodrag"
          placeholder={`Add a note as ${user.name}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary nodrag" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/* ---------- The node ---------- */

function NodeInner({ id, ynode, selected }) {
  const { provider, user } = useCollab();
  const { deleteElements } = useReactFlow();
  const contentType = useYMapValue(ynode, 'contentType');
  const setContentType = useCallback((value) => ynode.set('contentType', value), [ynode]);

  return (
    <div className={`mt-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />

      <div className="mt-header">
        <span className="drag-grip" title="Drag to move">⋮⋮</span>
        <CollabText ytext={ynode.get('title')} className="title-input nodrag" placeholder="Node title" />
        <button
          type="button"
          className="icon-btn nodrag"
          title="Delete node"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        >
          🗑
        </button>
      </div>

      <div className="mt-body">
        <select className="field select nodrag" value={contentType} onChange={(e) => setContentType(e.target.value)}>
          {NODE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <div className="mt-content">
          {contentType === 'text' && <TextContent ytext={ynode.get('text')} />}
          {contentType === 'image' && <ImageContent ytext={ynode.get('imageUrl')} />}
          {contentType === 'tiptap' && (
            <div className="nodrag">
              <TiptapEditor fragment={ynode.get('doc')} provider={provider} user={user} />
            </div>
          )}
          {contentType === 'json' && <JsonContent ytext={ynode.get('json')} />}
        </div>
      </div>

      <NotesSection ynotes={ynode.get('notes')} />

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// data.ynode is the node's Y.Map; the canvas swaps it in when a peer replaces the node (e.g. import).
function MultiTypeNode({ id, data, selected }) {
  return <NodeInner id={id} ynode={data.ynode} selected={selected} />;
}

export default memo(MultiTypeNode);
