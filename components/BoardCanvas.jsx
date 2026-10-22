'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MultiTypeNode from '@/components/MultiTypeNode';
import { OnlineUsers, RemoteCursors } from '@/components/Presence';
import { renameBoard, setLinkAccess } from '@/app/actions';
import { BOARD_VERSION, NODE_DEFAULT_SIZE, clampSize, createNode, initialBoard, sanitizeBoard } from '@/lib/board';
import { CollabContext, addNodeToDoc, docToBoard, newEdgeId, replaceBoardInDoc } from '@/lib/collab';
import { useCollabSession } from '@/lib/useCollabSession';

// Must be defined outside the component so React Flow doesn't re-mount nodes each render.
const nodeTypes = { multiType: MultiTypeNode };

const defaultEdgeOptions = {
  type: 'smoothstep',
  style: { strokeWidth: 2, stroke: '#94a3b8' },
};

const MINIMAP_COLORS = { text: '#60a5fa', image: '#f472b6', tiptap: '#a78bfa', json: '#34d399' };

const LINK_ACCESS_LABELS = {
  EDIT: 'Anyone with the link can edit',
  VIEW: 'Anyone with the link can view',
  NONE: 'Only current members',
};

/* ---------- Yjs → React Flow mirroring ---------- */

// React Flow keeps local view state (selected, measured, dragging); Yjs owns content and positions.
function syncNodesFromDoc(nodesMap, prev) {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const next = [];
  nodesMap.forEach((ynode, id) => {
    const position = ynode.get('position');
    const contentType = ynode.get('contentType');
    const size = ynode.get('size') ?? NODE_DEFAULT_SIZE;
    const p = prevById.get(id);
    if (p && (p.dragging || p.resizing) && p.data.ynode === ynode) {
      next.push(p); // our own drag/resize in progress wins locally
    } else if (
      p &&
      p.data.ynode === ynode &&
      p.data.contentType === contentType &&
      p.position.x === position.x &&
      p.position.y === position.y &&
      p.width === size.width &&
      p.height === size.height
    ) {
      next.push(p); // unchanged: keep identity so memoized nodes don't re-render
    } else {
      next.push({
        ...(p || { id, type: 'multiType' }),
        position,
        width: size.width,
        height: size.height,
        data: { ynode, contentType },
      });
    }
  });
  return next;
}

function syncEdgesFromDoc(edgesMap, nodesMap, prev) {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
  return [...edgesMap.values()]
    .filter((e) => nodesMap.has(e.source) && nodesMap.has(e.target))
    .map((e) => ({ ...e, selected: selected.has(e.id) }));
}

/* ---------- UI bits ---------- */

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.message}</div>;
}

function BoardTitle({ board, notify }) {
  const [title, setTitle] = useState(board.title);
  const [, startTransition] = useTransition();
  if (!board.isOwner) return <div className="brand">{title}</div>;

  const commit = () => {
    const next = title.trim() || 'Untitled board';
    setTitle(next);
    if (next === board.title) return;
    startTransition(async () => {
      try {
        await renameBoard(board.roomId, next);
        board.title = next;
      } catch (e) {
        notify(e.message, 'error');
      }
    });
  };

  return (
    <input
      className="board-title-input"
      value={title}
      maxLength={120}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label="Board title"
    />
  );
}

function SharePanel({ board, notify, onClose }) {
  const [linkAccess, setAccess] = useState(board.linkAccess);
  const [pending, startTransition] = useTransition();
  const url = typeof window !== 'undefined' ? window.location.href : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify('Link copied', 'success');
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const change = (value) => {
    setAccess(value);
    startTransition(async () => {
      try {
        await setLinkAccess(board.roomId, value);
        board.linkAccess = value;
        notify('Sharing updated', 'success');
      } catch (e) {
        setAccess(board.linkAccess);
        notify(e.message, 'error');
      }
    });
  };

  return (
    <div className="share-panel" role="dialog" aria-label="Share board">
      <div className="share-row">
        <input className="field" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button type="button" className="tb-btn primary" onClick={copy}>
          Copy
        </button>
      </div>
      {board.isOwner ? (
        <label className="share-row">
          <span className="muted">Link access</span>
          <select className="field select" value={linkAccess} disabled={pending} onChange={(e) => change(e.target.value)}>
            {Object.entries(LINK_ACCESS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="muted">{LINK_ACCESS_LABELS[linkAccess]}. People must sign in with Google to join.</div>
      )}
      <button type="button" className="link-btn" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function Canvas({ session, board }) {
  const { doc, room, nodesMap, edgesMap, awareness, user, status, readOnly } = session;
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [toast, setToast] = useState(null);
  const [totalNotes, setTotalNotes] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const fileInputRef = useRef(null);
  const pointerFrame = useRef(0);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const notify = useCallback((message, kind = 'info') => setToast({ message, kind, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----- Mirror the shared doc into React Flow ----- */
  useEffect(() => {
    const syncNodes = () => setNodes((prev) => syncNodesFromDoc(nodesMap, prev));
    const syncEdges = () => setEdges((prev) => syncEdgesFromDoc(edgesMap, nodesMap, prev));

    const countNotes = () => {
      let total = 0;
      nodesMap.forEach((ynode) => (total += ynode.get('notes')?.length || 0));
      setTotalNotes(total);
    };

    const onNodesDeep = (events) => {
      countNotes();
      // Ignore keystrokes in titles/notes/etc.; only structure, position and type affect the canvas.
      const relevant = events.some(
        (e) =>
          e.target === nodesMap ||
          (e.target.parent === nodesMap &&
            ['position', 'contentType', 'size'].some((key) => e.keysChanged.has(key))),
      );
      if (!relevant) return;
      syncNodes();
      if (events.some((e) => e.target === nodesMap)) syncEdges();
    };

    syncNodes();
    syncEdges();
    countNotes();
    requestAnimationFrame(() => fitView({ padding: 0.2 }));
    nodesMap.observeDeep(onNodesDeep);
    edgesMap.observe(syncEdges);
    return () => {
      nodesMap.unobserveDeep(onNodesDeep);
      edgesMap.unobserve(syncEdges);
    };
  }, [nodesMap, edgesMap, fitView]);

  /* ----- Local changes → shared doc ----- */
  const onNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      if (readOnly) return;
      doc.transact(() => {
        for (const c of changes) {
          if (c.type === 'position' && c.position) nodesMap.get(c.id)?.set('position', { ...c.position });
          // `resizing` is only set by the NodeResizer, not by React Flow measuring the DOM.
          else if (c.type === 'dimensions' && c.resizing !== undefined && c.dimensions)
            nodesMap.get(c.id)?.set('size', clampSize(c.dimensions));
          else if (c.type === 'remove') nodesMap.delete(c.id);
        }
      });
    },
    [doc, nodesMap, readOnly],
  );

  const onEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      if (readOnly) return;
      doc.transact(() => {
        for (const c of changes) if (c.type === 'remove') edgesMap.delete(c.id);
      });
    },
    [doc, edgesMap, readOnly],
  );

  const onConnect = useCallback(
    ({ source, target, sourceHandle = null, targetHandle = null }) => {
      const id = newEdgeId();
      edgesMap.set(id, { id, source, target, sourceHandle, targetHandle });
    },
    [edgesMap],
  );

  const addNode = useCallback(() => {
    // Drop the new node in the centre of the current viewport, slightly jittered so repeats don't stack.
    const jitter = () => Math.round((Math.random() - 0.5) * 80);
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node = createNode({ x: center.x - 160 + jitter(), y: center.y - 120 + jitter() });
    addNodeToDoc(doc, node);
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
  }, [doc, screenToFlowPosition]);

  /* ----- Live pointer ----- */
  const onPointerMove = useCallback(
    (e) => {
      const { clientX, clientY } = e;
      cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = requestAnimationFrame(() => {
        awareness.setLocalStateField('pointer', screenToFlowPosition({ x: clientX, y: clientY }));
      });
    },
    [awareness, screenToFlowPosition],
  );
  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(pointerFrame.current);
    awareness.setLocalStateField('pointer', null);
  }, [awareness]);

  /* ----- Export / Import / Sample ----- */
  const exportBoard = useCallback(() => {
    const exported = docToBoard(doc);
    const payload = { version: BOARD_VERSION, exportedAt: new Date().toISOString(), title: board.title, ...exported };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${board.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'board'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify('Board exported', 'success');
  }, [doc, board, notify]);

  const importBoard = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow re-importing the same file
      if (!file) return;
      try {
        const imported = sanitizeBoard(JSON.parse(await file.text()));
        if (nodesMap.size > 0 && !window.confirm('Replace this board for everyone?')) return;
        replaceBoardInDoc(doc, imported);
        requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
        notify(`Imported ${imported.nodes.length} nodes, ${imported.edges.length} edges`, 'success');
      } catch (e) {
        notify(`Import failed: ${e.message}`, 'error');
      }
    },
    [doc, nodesMap, fitView, notify],
  );

  const loadSample = useCallback(() => {
    if (nodesMap.size > 0 && !window.confirm('Replace this board with the sample template for everyone?')) return;
    replaceBoardInDoc(doc, initialBoard());
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
  }, [doc, nodesMap, fitView]);

  return (
    <div className="canvas-root" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={false}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background gap={20} size={1.2} color="#cbd5e1" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => MINIMAP_COLORS[n.data?.contentType] || '#94a3b8'}
          nodeBorderRadius={6}
        />
        <RemoteCursors awareness={awareness} />

        <Panel position="top-left" className="brand-panel">
          <Link href="/" className="back-link">
            ← Boards
          </Link>
          <BoardTitle board={board} notify={notify} />
          <div className="stats">
            {nodes.length} nodes · {edges.length} links · {totalNotes} notes
            {readOnly && <span className="badge-readonly">View only</span>}
          </div>
          <OnlineUsers awareness={awareness} room={room} status={status} />
        </Panel>

        <Panel position="top-right" className="toolbar">
          <div className="me" title={`Signed in as ${user.name}`}>
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="swatch" style={{ background: user.color }} />
            )}
            <span>{user.name}</span>
          </div>
          {!readOnly && (
            <button type="button" className="tb-btn primary" onClick={addNode}>
              ＋ Add Node
            </button>
          )}
          <button type="button" className="tb-btn accent" onClick={() => setShareOpen((o) => !o)}>
            🔗 Share
          </button>
          <button type="button" className="tb-btn" onClick={exportBoard}>
            ⬇ Export
          </button>
          {!readOnly && (
            <>
              <button type="button" className="tb-btn" onClick={() => fileInputRef.current?.click()}>
                ⬆ Import
              </button>
              <button type="button" className="tb-btn" onClick={loadSample} title="Replace with the sample board">
                ✨ Sample
              </button>
              <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={importBoard} hidden />
            </>
          )}
          {shareOpen && <SharePanel board={board} notify={notify} onClose={() => setShareOpen(false)} />}
        </Panel>

        {nodes.length === 0 && (
          <Panel position="top-center" className="empty-hint">
            {readOnly ? 'This board is empty.' : 'Empty board. Click ＋ Add Node, ⬆ Import a file, or ✨ Sample to start.'}
          </Panel>
        )}
      </ReactFlow>
      <Toast toast={toast} />
    </div>
  );
}

function BoardRoom({ board, user }) {
  const { session, error } = useCollabSession(board.roomId, user);
  const readOnly = board.role === 'VIEWER';
  const value = useMemo(
    () => (session ? { ...session, readOnly, isOwner: board.isOwner, roomId: board.roomId } : null),
    [session, readOnly, board.isOwner, board.roomId],
  );

  if (error) {
    return (
      <div className="loading-screen">
        <div className="join-error">
          <strong>Couldn&apos;t join this board.</strong>
          <span>{error}</span>
          <div className="share-row">
            <button type="button" className="tb-btn primary" onClick={() => window.location.reload()}>
              Retry
            </button>
            <Link href="/" className="tb-btn">
              My boards
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!value) return <div className="loading-screen">Loading board…</div>;

  return (
    <CollabContext.Provider value={value}>
      <Canvas session={value} board={board} />
    </CollabContext.Provider>
  );
}

export default function BoardCanvas({ board, user }) {
  // Stable identity object so awareness isn't re-published on every render.
  const me = useMemo(() => user, [user.id, user.name, user.image, user.color]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ReactFlowProvider>
      <BoardRoom board={board} user={me} />
    </ReactFlowProvider>
  );
}
