import * as Y from 'yjs';
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { getSchema } from '@tiptap/core';
import { generateHTML, generateJSON } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { createNodeData, makeId } from './board';

/*
 * Shared document layout (one Y.Doc per room):
 *
 *   nodes: Y.Map<nodeId, Y.Map {
 *     position:    { x, y }          last-writer-wins
 *     contentType: string            last-writer-wins
 *     title, text, imageUrl, json:   Y.Text (character-level merge)
 *     doc:         Y.XmlFragment     Tiptap rich text (character-level merge)
 *     notes:       Y.Array<{ id, author, color, message, createdAt }>
 *   }>
 *   edges: Y.Map<edgeId, { id, source, target, sourceHandle, targetHandle }>
 */

export const TEXT_FIELDS = ['title', 'text', 'imageUrl', 'json'];

const extensions = [StarterKit];
let schema;
const getEditorSchema = () => (schema ??= getSchema(extensions));

export function htmlToFragment(html, fragment) {
  const json = generateJSON(html || '<p></p>', extensions);
  return prosemirrorJSONToYXmlFragment(getEditorSchema(), json, fragment);
}

export function fragmentToHtml(fragment) {
  try {
    return generateHTML(yXmlFragmentToProsemirrorJSON(fragment), extensions);
  } catch {
    return '<p></p>';
  }
}

export function getMaps(doc) {
  return { nodesMap: doc.getMap('nodes'), edgesMap: doc.getMap('edges') };
}

// Must be called inside a transaction; the Y.Map is attached to the doc before children are filled.
function insertNode(nodesMap, { id, position, data }) {
  const d = { ...createNodeData(), ...data };
  const ynode = new Y.Map();
  nodesMap.set(id, ynode);
  ynode.set('position', { x: Number(position?.x) || 0, y: Number(position?.y) || 0 });
  ynode.set('contentType', d.contentType);
  for (const field of TEXT_FIELDS) {
    const ytext = new Y.Text();
    ynode.set(field, ytext);
    ytext.insert(0, String(d[field] ?? ''));
  }
  const fragment = new Y.XmlFragment();
  ynode.set('doc', fragment);
  htmlToFragment(d.html, fragment);
  const notes = new Y.Array();
  ynode.set('notes', notes);
  notes.push((d.notes || []).map((n) => ({ ...n })));
  return ynode;
}

export function addNodeToDoc(doc, node) {
  doc.transact(() => insertNode(getMaps(doc).nodesMap, node));
}

export function replaceBoardInDoc(doc, board) {
  const { nodesMap, edgesMap } = getMaps(doc);
  doc.transact(() => {
    nodesMap.clear();
    edgesMap.clear();
    board.nodes.forEach((n) => insertNode(nodesMap, n));
    board.edges.forEach((e) => edgesMap.set(e.id, { ...e }));
  });
}

export function docToBoard(doc) {
  const { nodesMap, edgesMap } = getMaps(doc);
  const nodes = [];
  nodesMap.forEach((ynode, id) => {
    const data = {
      contentType: ynode.get('contentType'),
      html: fragmentToHtml(ynode.get('doc')),
      notes: ynode.get('notes')?.toArray() ?? [],
    };
    for (const field of TEXT_FIELDS) data[field] = ynode.get(field)?.toString() ?? '';
    nodes.push({ id, type: 'multiType', position: ynode.get('position'), data });
  });
  return { nodes, edges: [...edgesMap.values()] };
}

export function newEdgeId() {
  return makeId('edge');
}

/* ---------- React bindings ---------- */

// Subscribes to a single key of a Y.Map (shallow), e.g. contentType or position.
export function useYMapValue(ymap, key) {
  const subscribe = useCallback(
    (cb) => {
      ymap.observe(cb);
      return () => ymap.unobserve(cb);
    },
    [ymap],
  );
  const read = () => ymap.get(key);
  return useSyncExternalStore(subscribe, read, read);
}

// Subscribes to a Y.Array and returns a plain array snapshot.
export function useYArray(yarray) {
  const [items, setItems] = useState(() => yarray.toArray());
  useEffect(() => {
    const update = () => setItems(yarray.toArray());
    update();
    yarray.observe(update);
    return () => yarray.unobserve(update);
  }, [yarray]);
  return items;
}

/* ---------- Session context ---------- */

// { doc, nodesMap, edgesMap, provider, awareness, user: { name, color } }
export const CollabContext = createContext(null);
export const useCollab = () => useContext(CollabContext);

export const USER_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'];
export const randomColor = () => USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
