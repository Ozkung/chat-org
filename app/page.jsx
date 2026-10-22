'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  BOARD_VERSION,
  LEGACY_STORAGE_KEY,
  USER_KEY,
  createNode,
  initialBoard,
  makeRoomId,
  sanitizeBoard,
} from '@/lib/board';
import { CollabContext, addNodeToDoc, docToBoard, newEdgeId, randomColor, replaceBoardInDoc } from '@/lib/collab';
import { useCollabSession } from '@/lib/useCollabSession';

// Must be defined outside the component so React Flow doesn't re-mount nodes each render.
const nodeTypes = { multiType: MultiTypeNode };

const defaultEdgeOptions = {
  type: 'smoothstep',
  style: { strokeWidth: 2, stroke: '#94a3b8' },
};

const MINIMAP_COLORS = { text: '#60a5fa', image: '#f472b6', tiptap: '#a78bfa', json: '#34d399' };

/* ---------- Room + identity bootstrap (runs once in the browser) ---------- */

function readLegacyBoard() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(LEGACY_STORAGE_KEY); // migrate into the first new room only
    return sanitizeBoard(JSON.parse(raw));
  } catch {
    return null;
  }
}

function resolveRoom() {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get('room');
  if (existing) return { roomId: existing, seed: null };
  // No room in the URL: this browser creates a new one and fills it with a starter board.
  const roomId = makeRoomId();
  url.searchParams.set('room', roomId);
  window.history.replaceState(null, '', url);
  return { roomId, seed: readLegacyBoard() ?? initialBoard() };
}

function loadUser() {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    if (saved?.name && saved?.color) return saved;
  } catch {
    /* ignore */
  }
  return { name: `Guest ${Math.floor(100 + Math.random() * 900)}`, color: randomColor() };
}

/* ---------- Yjs → React Flow mirroring ---------- */

// React Flow keeps local view state (selected, measured, dragging); Yjs owns content and positions.
function syncNodesFromDoc(nodesMap, prev) {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const next = [];
  nodesMap.forEach((ynode, id) => {
    const position = ynode.get('position');
    const contentType = ynode.get('contentType');
    const p = prevById.get(id);
    if (p && p.dragging && p.data.ynode === ynode) {
      next.push(p); // our own drag in progress wins locally
    } else if (
      p &&
      p.data.ynode === ynode &&
      p.data.contentType === contentType &&
      p.position.x === position.x &&
      p.position.y === position.y
    ) {
      next.push(p); // unchanged: keep identity so memoized nodes don't re-render
    } else {
      next.push({ ...(p || { id, type: 'multiType' }), position, data: { ynode, contentType } });
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

function Canvas({ session, onRename }) {
  const { doc, nodesMap, edgesMap, awareness, user, status } = session;
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [toast, setToast] = useState(null);
  const [totalNotes, setTotalNotes] = useState(0);
  const [nameDraft, setNameDraft] = useState(user.name);
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
          (e.target.parent === nodesMap && (e.keysChanged.has('position') || e.keysChanged.has('contentType'))),
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
      doc.transact(() => {
        for (const c of changes) {
          if (c.type === 'position' && c.position) nodesMap.get(c.id)?.set('position', { ...c.position });
          else if (c.type === 'remove') nodesMap.delete(c.id);
        }
      });
    },
    [doc, nodesMap],
  );

  const onEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      doc.transact(() => {
        for (const c of changes) if (c.type === 'remove') edgesMap.delete(c.id);
      });
    },
    [doc, edgesMap],
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

  /* ----- Export / Import / Share ----- */
  const exportBoard = useCallback(() => {
    const board = docToBoard(doc);
    const payload = { version: BOARD_VERSION, exportedAt: new Date().toISOString(), ...board };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `discussion-board-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify('Board exported', 'success');
  }, [doc, notify]);

  const importBoard = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow re-importing the same file
      if (!file) return;
      try {
        const board = sanitizeBoard(JSON.parse(await file.text()));
        if (nodesMap.size > 0 && !window.confirm('Replace this board for everyone in the room?')) return;
        replaceBoardInDoc(doc, board);
        requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
        notify(`Imported ${board.nodes.length} nodes, ${board.edges.length} edges`, 'success');
      } catch (e) {
        notify(`Import failed: ${e.message}`, 'error');
      }
    },
    [doc, nodesMap, fitView, notify],
  );

  const resetBoard = useCallback(() => {
    if (!window.confirm('Reset this board to the sample template for everyone in the room?')) return;
    replaceBoardInDoc(doc, initialBoard());
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
    notify('Board reset', 'info');
  }, [doc, fitView, notify]);

  const shareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('Invite link copied — anyone with it can join and edit', 'success');
    } catch {
      window.prompt('Copy this invite link:', window.location.href);
    }
  }, [notify]);

  const newBoard = useCallback(() => {
    window.open(window.location.pathname, '_blank', 'noopener');
  }, []);

  const commitName = () => {
    const name = nameDraft.trim().slice(0, 40);
    if (name && name !== user.name) onRename(name);
    else setNameDraft(user.name);
  };

  return (
    <div className="canvas-root" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background gap={20} size={1.2} color="#cbd5e1" />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => MINIMAP_COLORS[n.data?.contentType] || '#94a3b8'}
          nodeBorderRadius={6}
        />
        <RemoteCursors awareness={awareness} />

        <Panel position="top-left" className="brand-panel">
          <div className="brand">🧭 Discussion Canvas</div>
          <div className="stats">
            {nodes.length} nodes · {edges.length} links · {totalNotes} notes
          </div>
          <OnlineUsers awareness={awareness} status={status} />
        </Panel>

        <Panel position="top-right" className="toolbar">
          <label className="author-field" title="Your name and colour, shown to everyone in the room">
            <span className="swatch" style={{ background: user.color }} />
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="Your name"
              maxLength={40}
            />
          </label>
          <button type="button" className="tb-btn primary" onClick={addNode}>
            ＋ Add Node
          </button>
          <button type="button" className="tb-btn accent" onClick={shareLink}>
            🔗 Invite
          </button>
          <button type="button" className="tb-btn" onClick={exportBoard}>
            ⬇ Export
          </button>
          <button type="button" className="tb-btn" onClick={() => fileInputRef.current?.click()}>
            ⬆ Import
          </button>
          <button type="button" className="tb-btn" onClick={newBoard} title="Open a fresh board in a new tab">
            ✚ New board
          </button>
          <button type="button" className="tb-btn danger" onClick={resetBoard} title="Reset to sample board">
            ↺ Reset
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={importBoard} hidden />
        </Panel>

        {nodes.length === 0 && (
          <Panel position="top-center" className="empty-hint">
            Empty board. Add a node, or wait a moment for others in the room to sync.
          </Panel>
        )}
      </ReactFlow>
      <Toast toast={toast} />
    </div>
  );
}

function Room() {
  const [room, setRoom] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    setRoom(resolveRoom());
    setUser(loadUser());
  }, []);

  const rename = useCallback((name) => setUser((u) => ({ ...u, name })), []);

  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* non-critical */
    }
  }, [user]);

  const { session, error } = useCollabSession(room?.roomId, room?.seed, user);

  if (error) {
    return (
      <div className="loading-screen">
        <div className="join-error">
          <strong>Couldn&apos;t join this board.</strong>
          <span>{error}</span>
          <button type="button" className="tb-btn primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!session) return <div className="loading-screen">Joining board…</div>;

  return (
    <CollabContext.Provider value={session}>
      <Canvas session={session} onRename={rename} />
    </CollabContext.Provider>
  );
}

export default function Page() {
  return (
    <ReactFlowProvider>
      <Room />
    </ReactFlowProvider>
  );
}
