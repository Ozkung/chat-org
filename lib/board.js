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

// Room ids appear in share links; keep them long enough not to be guessable.
export function makeRoomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 6)).join('');
}

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

// Nodes are resizable; these are the limits and the size of new nodes.
export const NODE_MIN_SIZE = { width: 300, height: 600 };
export const NODE_DEFAULT_SIZE = { width: 320, height: 600 };

export function clampSize(size) {
  const n = (v, min) => Math.max(min, Math.round(Number(v) || 0));
  return { width: n(size?.width, NODE_MIN_SIZE.width), height: n(size?.height, NODE_MIN_SIZE.height) };
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
    size: { ...NODE_DEFAULT_SIZE },
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
        { id: makeId('note'), author: 'Facilitator', color: '#7c3aed', message: 'Welcome! Leave comments on each topic.', createdAt: now },
      ],
    }),
  };
  const design = {
    id: 'node_design',
    type: 'multiType',
    position: { x: 0, y: 760 },
    data: createNodeData({
      title: 'Design: New Dashboard',
      contentType: 'image',
      imageUrl: 'https://picsum.photos/seed/dashboard/600/340',
    }),
  };
  const api = {
    id: 'node_api',
    type: 'multiType',
    position: { x: 720, y: 760 },
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

// Stable per-user colour (cursor, avatar, note author) derived from the user id.
const USER_PALETTE = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'];
export function colorForUser(id = '') {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return USER_PALETTE[hash % USER_PALETTE.length];
}
