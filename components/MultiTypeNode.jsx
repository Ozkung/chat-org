'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, useReactFlow } from '@xyflow/react';
import dynamic from 'next/dynamic';
import { NODE_MIN_SIZE, NODE_TYPES, initials, makeId } from '@/lib/board';
import { useCollab, useYArray, useYMapValue } from '@/lib/collab';
import { prepareImage, uploadImage } from '@/lib/image';
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

function TextContent({ ytext, readOnly }) {
  return (
    <CollabText
      ytext={ytext}
      multiline
      readOnly={readOnly}
      className="field textarea nodrag nowheel"
      rows={5}
      placeholder={readOnly ? '' : 'Quick notes…'}
    />
  );
}

function ImageContent({ ytext, readOnly }) {
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
        readOnly={readOnly}
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

function JsonContent({ ytext, readOnly }) {
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
        readOnly={readOnly}
        className={`field textarea mono nodrag nowheel ${error ? 'invalid' : ''}`}
        rows={7}
        spellCheck={false}
      />
      <div className="json-footer">
        <span className={error ? 'error-text' : 'ok-text'}>{error ? `✖ ${error}` : '✔ Valid JSON'}</span>
        {!readOnly && (
          <button type="button" className="link-btn nodrag" onClick={format} disabled={!!error}>
            Format
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Notes / discussion section (text + photos) ---------- */

function NoteComposer({ ynotes, onPosted }) {
  const { user, roomId } = useCollab();
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null); // { prepared, previewUrl }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => () => attachment && URL.revokeObjectURL(attachment.previewUrl), [attachment]);

  const attach = async (file) => {
    setError(null);
    try {
      const prepared = await prepareImage(file);
      setAttachment({ prepared, previewUrl: URL.createObjectURL(prepared.blob) });
    } catch (e) {
      setError(e.message);
    }
  };

  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      attach(file);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const message = draft.trim();
    if ((!message && !attachment) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const image = attachment ? await uploadImage(roomId, attachment.prepared) : undefined;
      ynotes.push([
        {
          id: makeId('note'),
          authorId: user.id,
          author: user.name,
          color: user.color,
          message,
          ...(image ? { image } : {}),
          createdAt: new Date().toISOString(),
        },
      ]);
      setDraft('');
      setAttachment(null);
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="note-form" onSubmit={submit}>
      {attachment && (
        <div className="attachment">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.previewUrl} alt="Attachment preview" />
          <button type="button" className="note-delete visible nodrag" title="Remove photo" onClick={() => setAttachment(null)}>
            ✕
          </button>
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="note-form-row">
        <button
          type="button"
          className="icon-btn attach-btn nodrag"
          title="Add a photo (camera or library)"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          📷
        </button>
        {/* No `capture` attribute: phones then offer both "Take photo" and "Photo library". */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) attach(file);
          }}
        />
        <input
          className="field nodrag"
          placeholder={`Add a note as ${user.name}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
        />
        <button type="submit" className="btn-primary nodrag" disabled={busy || (!draft.trim() && !attachment)}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

function NotesSection({ ynotes }) {
  const { user, readOnly, isOwner } = useCollab();
  const notes = useYArray(ynotes);
  const [open, setOpen] = useState(false); // per-viewer UI state, not shared
  const listRef = useRef(null);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, notes.length]);

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
                    {!readOnly && (isOwner || n.authorId === user.id) && (
                      <button type="button" className="note-delete nodrag" title="Delete note" onClick={() => remove(n.id)}>
                        ✕
                      </button>
                    )}
                  </div>
                  {n.image?.url && (
                    <a href={n.image.url} target="_blank" rel="noreferrer" className="note-image nodrag">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={n.image.url}
                        alt="Photo"
                        loading="lazy"
                        draggable={false}
                        style={n.image.width ? { aspectRatio: `${n.image.width} / ${n.image.height}` } : undefined}
                      />
                    </a>
                  )}
                  {n.message && <div className="note-message">{n.message}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && <NoteComposer ynotes={ynotes} onPosted={() => setOpen(true)} />}
    </div>
  );
}

/* ---------- The node ---------- */

function NodeInner({ id, ynode, selected }) {
  const { provider, user, readOnly } = useCollab();
  const { deleteElements } = useReactFlow();
  const contentType = useYMapValue(ynode, 'contentType');
  const setContentType = useCallback((value) => ynode.set('contentType', value), [ynode]);

  return (
    <div className={`mt-node ${selected ? 'selected' : ''}`}>
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={NODE_MIN_SIZE.width}
        minHeight={NODE_MIN_SIZE.height}
        lineClassName="resize-line"
        handleClassName="resize-handle"
      />
      <Handle type="target" position={Position.Top} isConnectable={!readOnly} />

      <div className="mt-header">
        <span className="drag-grip" title="Drag to move">⋮⋮</span>
        <CollabText ytext={ynode.get('title')} readOnly={readOnly} className="title-input nodrag" placeholder="Node title" />
        {!readOnly && (
          <button
            type="button"
            className="icon-btn nodrag"
            title="Delete node"
            onClick={() => deleteElements({ nodes: [{ id }] })}
          >
            🗑
          </button>
        )}
      </div>

      <div className="mt-body nowheel">
        <select
          className="field select nodrag"
          value={contentType}
          disabled={readOnly}
          onChange={(e) => setContentType(e.target.value)}
        >
          {NODE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <div className="mt-content">
          {contentType === 'text' && <TextContent ytext={ynode.get('text')} readOnly={readOnly} />}
          {contentType === 'image' && <ImageContent ytext={ynode.get('imageUrl')} readOnly={readOnly} />}
          {contentType === 'tiptap' && (
            <div className="nodrag">
              <TiptapEditor fragment={ynode.get('doc')} provider={provider} user={user} editable={!readOnly} />
            </div>
          )}
          {contentType === 'json' && <JsonContent ytext={ynode.get('json')} readOnly={readOnly} />}
        </div>
      </div>

      <NotesSection ynotes={ynode.get('notes')} />

      <Handle type="source" position={Position.Bottom} isConnectable={!readOnly} />
    </div>
  );
}

// data.ynode is the node's Y.Map; the canvas swaps it in when a peer replaces the node (e.g. import).
function MultiTypeNode({ id, data, selected }) {
  return <NodeInner id={id} ynode={data.ynode} selected={selected} />;
}

export default memo(MultiTypeNode);
