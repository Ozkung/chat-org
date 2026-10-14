# 🧭 Discussion Canvas

A whiteboard for meetings where each topic is a node. You can drag nodes, connect them, and switch what a node holds (plain text, an image, rich text, or JSON). Every node has its own **💬 Notes** thread for team comments.

No backend: the board saves itself to `localStorage`, and you can export or import it as a `.json` file.

## Tech stack

- **Next.js 16** (App Router, client components)
- **@xyflow/react 12** (React Flow, MIT): canvas, edges, MiniMap, Controls
- **@tiptap/react 3 + @tiptap/starter-kit**: rich-text editor inside nodes
- Plain CSS (`app/globals.css`), no Tailwind setup needed

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

Production build:

```bash
npm run build && npm start
```

### Starting from scratch instead

```bash
npx create-next-app@latest discussion-canvas --js --app --no-tailwind --no-src-dir --import-alias "@/*"
cd discussion-canvas
npm install @xyflow/react @tiptap/react @tiptap/pm @tiptap/starter-kit
# then copy app/, components/, lib/ from this repo
```

## Features

| Area | What it does |
| --- | --- |
| Canvas | Drag, pan, zoom, connect handles (top = input, bottom = output), MiniMap colored by node type, zoom controls |
| Node types | 📄 Text · 🖼️ Image (URL + live preview + error state) · ✍️ Tiptap (toolbar: bold/italic/strike/H2/lists/code) · 📊 JSON (live validation + Format) |
| Switching types | Each type keeps its own field, so switching back and forth doesn't lose content |
| Notes | Collapsible thread per node with a count, author avatar, timestamp, and a delete button on hover. The input stays visible even when the thread is collapsed |
| Author | Set "your name" in the toolbar. It is saved and attached to every note you post |
| Persistence | Saves to `localStorage` automatically, 400 ms after the last change. A "Saved hh:mm" indicator shows the last save |
| Export / Import | Download the board as `.json`. Imported files are checked and cleaned (bad edges are dropped, missing fields get defaults) |
| Delete | 🗑 on the node, or select it and press `Backspace`/`Delete` |

## Project structure

```
app/
  layout.jsx            Root layout + global CSS
  page.jsx              Canvas: React Flow, localStorage, toolbar, export/import
  globals.css           All styling
  icon.svg              Favicon
components/
  MultiTypeNode.jsx     Custom node: title, type dropdown, content, notes
  TiptapEditor.jsx      Tiptap editor + toolbar (loaded client-only)
lib/
  board.js              Node factory, sample board, import validation, author context
```

## Board file format

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "node_ab12cd34",
      "type": "multiType",
      "position": { "x": 0, "y": 0 },
      "data": {
        "title": "Topic",
        "contentType": "text | image | tiptap | json",
        "text": "", "imageUrl": "", "html": "<p></p>", "json": "{}",
        "notes": [{ "id": "note_1", "author": "Alice", "message": "Hi", "createdAt": "2026-10-14T10:00:00.000Z" }],
        "notesOpen": false
      }
    }
  ],
  "edges": [{ "id": "e1", "source": "node_a", "target": "node_b" }]
}
```

## Implementation notes

- Interactive elements inside nodes use React Flow's `nodrag` class, and scrollable areas use `nowheel`. That way typing, selecting text, and scrolling don't drag the node or zoom the canvas.
- Nodes update through `useReactFlow().updateNodeData`, so the parent doesn't pass callbacks down through `data`.
- Tiptap uses `immediatelyRender: false` and is loaded with `next/dynamic({ ssr: false })` to avoid hydration mismatches.
- "Collaboration" here means one shared screen in a meeting, or passing exported files around. For real-time multi-user editing, you could swap `localStorage` for a Yjs provider (for example `y-websocket`). React Flow and Tiptap both have Yjs bindings.
