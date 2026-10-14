'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import dynamic from 'next/dynamic';
import { NODE_TYPES, makeId, useAuthor } from '@/lib/board';

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

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/* ---------- Content renderers (one per type) ---------- */

function TextContent({ value, onChange }) {
  return (
    <textarea
      className="field textarea nodrag nowheel"
      rows={5}
      placeholder="Quick notes…"
      value={value}
      onChange={(e) => onChange({ text: e.target.value })}
    />
  );
}

function ImageContent({ value, onChange }) {
  const [status, setStatus] = useState('idle'); // idle | loading | ok | error

  useEffect(() => {
    setStatus(value ? 'loading' : 'idle');
  }, [value]);

  return (
    <div className="image-content">
      <input
        className="field nodrag"
        type="url"
        placeholder="https://example.com/image.png"
        value={value}
        onChange={(e) => onChange({ imageUrl: e.target.value.trim() })}
      />
      <div className="image-preview">
        {status === 'idle' && <span className="muted">Paste an image URL to preview</span>}
        {value && status !== 'error' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
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

function JsonContent({ value, onChange }) {
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
      onChange({ json: JSON.stringify(JSON.parse(value), null, 2) });
    } catch {
      /* keep as-is when invalid */
    }
  };

  return (
    <div>
      <textarea
        className={`field textarea mono nodrag nowheel ${error ? 'invalid' : ''}`}
        rows={7}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange({ json: e.target.value })}
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

function NotesSection({ notes, open, onToggle, onAdd, onDelete }) {
  const author = useAuthor();
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, notes.length]);

  const submit = (e) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message) return;
    onAdd({ id: makeId('note'), author: author || 'Anonymous', message, createdAt: new Date().toISOString() });
    setDraft('');
  };

  return (
    <div className="notes">
      <button type="button" className="notes-toggle nodrag" onClick={onToggle} aria-expanded={open}>
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
                <div className="avatar" title={n.author}>{initials(n.author)}</div>
                <div className="note-main">
                  <div className="note-meta">
                    <strong>{n.author}</strong>
                    <span className="muted">{formatTime(n.createdAt)}</span>
                    <button
                      type="button"
                      className="note-delete nodrag"
                      title="Delete note"
                      onClick={() => onDelete(n.id)}
                    >
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
          placeholder={`Add a note as ${author || 'Anonymous'}…`}
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

function MultiTypeNode({ id, data, selected }) {
  const { updateNodeData, deleteElements } = useReactFlow();

  const update = useCallback((patch) => updateNodeData(id, patch), [id, updateNodeData]);
  const onHtmlChange = useCallback((html) => updateNodeData(id, { html }), [id, updateNodeData]);

  const addNote = useCallback(
    (note) => updateNodeData(id, (node) => ({ notes: [...(node.data.notes || []), note], notesOpen: true })),
    [id, updateNodeData],
  );
  const deleteNote = useCallback(
    (noteId) => updateNodeData(id, (node) => ({ notes: node.data.notes.filter((n) => n.id !== noteId) })),
    [id, updateNodeData],
  );

  const notes = data.notes || [];

  return (
    <div className={`mt-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />

      <div className="mt-header">
        <span className="drag-grip" title="Drag to move">⋮⋮</span>
        <input
          className="title-input nodrag"
          value={data.title}
          placeholder="Node title"
          onChange={(e) => update({ title: e.target.value })}
        />
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
        <select
          className="field select nodrag"
          value={data.contentType}
          onChange={(e) => update({ contentType: e.target.value })}
        >
          {NODE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <div className="mt-content">
          {data.contentType === 'text' && <TextContent value={data.text} onChange={update} />}
          {data.contentType === 'image' && <ImageContent value={data.imageUrl} onChange={update} />}
          {data.contentType === 'tiptap' && (
            <div className="nodrag">
              <TiptapEditor value={data.html} onChange={onHtmlChange} />
            </div>
          )}
          {data.contentType === 'json' && <JsonContent value={data.json} onChange={update} />}
        </div>
      </div>

      <NotesSection
        notes={notes}
        open={!!data.notesOpen}
        onToggle={() => update({ notesOpen: !data.notesOpen })}
        onAdd={addNote}
        onDelete={deleteNote}
      />

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(MultiTypeNode);
