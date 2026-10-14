import { createContext, useContext } from 'react';

export const STORAGE_KEY = 'discussion-canvas:board:v1';
export const AUTHOR_KEY = 'discussion-canvas:author';
export const BOARD_VERSION = 1;

export const NODE_TYPES = [
  { value: 'text', label: '📄 Text' },
  { value: 'image', label: '🖼️ Image' },
  { value: 'tiptap', label: '✍️ Tiptap' },
  { value: 'json', label: '📊 JSON' },
];

export function makeId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Each content type keeps its own field, so switching type never loses data.
export function createNodeData(overrides = {}) {
  return {
    title: 'Untitled topic',
    contentType: 'text',
    text: '',
    imageUrl: '',
    html: '<p></p>',
    json: '{\n  \n}',
    notes: [],
    notesOpen: false,
    ...overrides,
  };
}

export function createNode(position, overrides = {}) {
  return {
    id: makeId('node'),
    type: 'multiType',
    position,
    data: createNodeData(overrides),
  };
}

export function initialBoard() {
  const now = new Date().toISOString();
  const root = {
    id: 'node_root',
    type: 'multiType',
    position: { x: 360, y: 40 },
    data: createNodeData({
      title: 'Q3 Planning Meeting',
      contentType: 'tiptap',
      html: '<h2>Agenda</h2><ul><li>Review roadmap</li><li>Assign owners</li><li>Open questions</li></ul>',
      notes: [
        { id: makeId('note'), author: 'Facilitator', message: 'Welcome! Leave comments on each topic.', createdAt: now },
      ],
      notesOpen: true,
    }),
  };
  const design = {
    id: 'node_design',
    type: 'multiType',
    position: { x: 60, y: 420 },
    data: createNodeData({
      title: 'Design: New Dashboard',
      contentType: 'image',
      imageUrl: 'https://picsum.photos/seed/dashboard/600/340',
    }),
  };
  const api = {
    id: 'node_api',
    type: 'multiType',
    position: { x: 660, y: 420 },
    data: createNodeData({
      title: 'API Contract',
      contentType: 'json',
      json: JSON.stringify({ endpoint: '/v1/reports', method: 'GET', owner: 'backend' }, null, 2),
    }),
  };
  return {
    nodes: [root, design, api],
    edges: [
      { id: 'e_root_design', source: 'node_root', target: 'node_design' },
      { id: 'e_root_api', source: 'node_root', target: 'node_api' },
    ],
  };
}

// Validates and normalises a parsed board (from localStorage or an imported file).
export function sanitizeBoard(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('File must contain "nodes" and "edges" arrays.');
  }
  const nodes = raw.nodes
    .filter((n) => n && typeof n.id === 'string')
    .map((n) => ({
      id: n.id,
      type: 'multiType',
      position: {
        x: Number(n.position?.x) || 0,
        y: Number(n.position?.y) || 0,
      },
      data: {
        ...createNodeData(),
        ...(n.data || {}),
        notes: Array.isArray(n.data?.notes) ? n.data.notes : [],
      },
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = raw.edges
    .filter((e) => e && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id : makeId('edge'),
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    }));
  return { nodes, edges };
}

// Current user's display name, shared with every node for authoring notes.
export const AuthorContext = createContext('Anonymous');
export const useAuthor = () => useContext(AuthorContext);
