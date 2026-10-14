'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MultiTypeNode from '@/components/MultiTypeNode';
import {
  AUTHOR_KEY,
  AuthorContext,
  BOARD_VERSION,
  STORAGE_KEY,
  createNode,
  initialBoard,
  sanitizeBoard,
} from '@/lib/board';

// Must be defined outside the component so React Flow doesn't re-mount nodes each render.
const nodeTypes = { multiType: MultiTypeNode };

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: { strokeWidth: 2, stroke: '#94a3b8' },
};

const MINIMAP_COLORS = { text: '#60a5fa', image: '#f472b6', tiptap: '#a78bfa', json: '#34d399' };

function readStoredBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeBoard(JSON.parse(raw));
  } catch (e) {
    console.warn('Ignoring corrupt saved board:', e);
  }
  return initialBoard();
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.message}</div>;
}

function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [hydrated, setHydrated] = useState(false);
  const [author, setAuthor] = useState('');
  const [toast, setToast] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const fileInputRef = useRef(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const notify = useCallback((message, kind = 'info') => {
    setToast({ message, kind, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----- Load from localStorage once on the client ----- */
  useEffect(() => {
    const board = readStoredBoard();
    setNodes(board.nodes);
    setEdges(board.edges);
    try {
      setAuthor(localStorage.getItem(AUTHOR_KEY) || 'Guest');
    } catch {
      setAuthor('Guest');
    }
    setHydrated(true);
    requestAnimationFrame(() => fitView({ padding: 0.2 }));
  }, [setNodes, setEdges, fitView]);

  /* ----- Auto-save (debounced) ----- */
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        const payload = {
          version: BOARD_VERSION,
          nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
          edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
            id, source, target, sourceHandle, targetHandle,
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setSavedAt(new Date());
      } catch (e) {
        notify('Could not save to localStorage (storage full?)', 'error');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges, hydrated, notify]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(AUTHOR_KEY, author);
    } catch {
      /* non-critical */
    }
  }, [author, hydrated]);

  /* ----- Graph interactions ----- */
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const addNode = useCallback(() => {
    // Drop the new node in the centre of the current viewport, slightly jittered so repeats don't stack.
    const jitter = () => Math.round((Math.random() - 0.5) * 80);
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node = createNode({ x: center.x - 160 + jitter(), y: center.y - 120 + jitter() });
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
  }, [screenToFlowPosition, setNodes]);

  /* ----- Export / Import ----- */
  const exportBoard = useCallback(() => {
    const payload = {
      version: BOARD_VERSION,
      exportedAt: new Date().toISOString(),
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
        id, source, target, sourceHandle, targetHandle,
      })),
    };
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
  }, [nodes, edges, notify]);

  const importBoard = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow re-importing the same file
      if (!file) return;
      try {
        const board = sanitizeBoard(JSON.parse(await file.text()));
        setNodes(board.nodes);
        setEdges(board.edges);
        requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
        notify(`Imported ${board.nodes.length} nodes, ${board.edges.length} edges`, 'success');
      } catch (e) {
        notify(`Import failed: ${e.message}`, 'error');
      }
    },
    [setNodes, setEdges, fitView, notify],
  );

  const resetBoard = useCallback(() => {
    if (!window.confirm('Reset the board to the sample template? Unsaved exports will be lost.')) return;
    const board = initialBoard();
    setNodes(board.nodes);
    setEdges(board.edges);
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
    notify('Board reset', 'info');
  }, [setNodes, setEdges, fitView, notify]);

  const totalNotes = nodes.reduce((sum, n) => sum + (n.data?.notes?.length || 0), 0);

  return (
    <AuthorContext.Provider value={author.trim() || 'Anonymous'}>
      <div className="canvas-root">
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

          <Panel position="top-left" className="brand-panel">
            <div className="brand">🧭 Discussion Canvas</div>
            <div className="stats">
              {nodes.length} nodes · {edges.length} links · {totalNotes} notes
              {savedAt && <span className="saved"> · Saved {savedAt.toLocaleTimeString()}</span>}
            </div>
          </Panel>

          <Panel position="top-right" className="toolbar">
            <label className="author-field" title="Your name is attached to the notes you post">
              <span>👤</span>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name"
                maxLength={40}
              />
            </label>
            <button type="button" className="tb-btn primary" onClick={addNode}>
              ＋ Add Node
            </button>
            <button type="button" className="tb-btn" onClick={exportBoard}>
              ⬇ Export
            </button>
            <button type="button" className="tb-btn" onClick={() => fileInputRef.current?.click()}>
              ⬆ Import
            </button>
            <button type="button" className="tb-btn danger" onClick={resetBoard} title="Reset to sample board">
              ↺ Reset
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={importBoard}
              hidden
            />
          </Panel>
        </ReactFlow>
        <Toast toast={toast} />
      </div>
    </AuthorContext.Provider>
  );
}

export default function Page() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
