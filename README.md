# 🧭 Discussion Canvas

A whiteboard for meetings where each topic is a node. You can drag nodes, connect them, and switch what a node holds (plain text, an image, rich text, or JSON). Every node has its own **💬 Notes** thread for team comments.

**Live co-op:** share the room link, and everyone edits the same board at the same time. You see each other's mouse pointers, who is online, and each other's carets inside rich-text nodes. There is no account and no database. Browsers sync directly with each other (WebRTC + [Yjs](https://yjs.dev)). They find each other through free public Nostr relays (via [Trystero](https://github.com/dmotz/trystero)), and each browser also keeps its own copy in IndexedDB.

## Tech stack

- **Next.js 16** (App Router, client components)
- **@xyflow/react 12** (React Flow, MIT): canvas, edges, MiniMap, Controls
- **@tiptap/react 3** + StarterKit + Collaboration / CollaborationCaret: rich text inside nodes
- **Yjs** (CRDT) + **Trystero** (WebRTC peer discovery over Nostr relays) + **y-indexeddb** (local copy)
- Plain CSS (`app/globals.css`), no Tailwind setup needed

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

Opening `/` creates a new room and adds `?room=<id>` to the URL. Click **🔗 Invite** to copy the link and send it to others.

To try co-op alone, open the link in another browser, a private window, or on your phone.

Production build: `npm run build && npm start`

## Deploy on Vercel

Import the repo at <https://vercel.com/new> and keep the default settings. Nothing else is required: Vercel only serves the page, and syncing happens between visitors' browsers.

If Vercel shows its own login screen, either share your production domain (e.g. `chat-org.vercel.app`) or disable **Settings → Deployment Protection → Vercel Authentication**.

## How co-op works

```
Browser A ──┐  encrypted "here I am" offers   ┌── Browser B
            └──────► 5 public Nostr relays ◄────┘   (picked from ~30, any one is enough)
Browser A ◄════ WebRTC data channel (board edits + presence) ════► Browser B
   │                                                       │
IndexedDB (local copy per room)                 IndexedDB (local copy per room)
```

- **Relays:** only introduce browsers to each other. The offers they carry are encrypted with the room id, and board content never passes through them. Because 5 relays are used at once, a few going offline doesn't break co-op.
- **Merging:** Yjs merges simultaneous edits. Titles, text, URLs and JSON merge character by character. Rich text merges as a document. Notes are an append-only list. Node position and type are last-writer-wins.
- **Persistence:** a room survives as long as **anyone** who has opened it still has their local copy. When someone rejoins, their copy merges with everyone else's. To keep a durable backup, use **⬇ Export**.
- **Status dot:** green = connected to at least one relay or peer; amber = still looking (edits are saved locally and sync once connected). Hover it for peer and relay counts.

### Limitations of peer-to-peer

1. **Strict networks.** Only STUN is used, with no TURN relay. Some corporate or mobile networks block direct WebRTC connections, so those users can't reach peers even when relays work.
2. **Access control.** Anyone with the room link can join and edit, so treat the link like a password. Room ids are 16 random hex characters.
3. **Custom relays (optional).** To use your own Nostr relays instead of the public list, set `NEXT_PUBLIC_NOSTR_RELAYS=wss://relay.one,wss://relay.two` in Vercel's environment variables and redeploy.

## Features

| Area | What it does |
| --- | --- |
| Canvas | Drag, pan, zoom, connect handles (top = input, bottom = output), MiniMap colored by node type, zoom controls |
| Node types | 📄 Text · 🖼️ Image (URL + live preview + error state) · ✍️ Tiptap (toolbar: bold/italic/strike/H2/lists/code) · 📊 JSON (live validation + Format) |
| Switching types | Each type keeps its own field, so switching back and forth doesn't lose content |
| Notes | Collapsible thread per node with a count, author avatar in the author's color, timestamp, and delete on hover |
| Co-op | Shared rooms via URL, live cursors with names, avatars of who's online, live rich-text co-editing with named carets, and a connection status dot |
| Identity | Name and color shown to others. Edit your name in the toolbar; it is remembered per browser |
| Export / Import | Download the board as `.json`. Importing replaces the board for everyone in the room, after a confirmation |
| Rooms | **✚ New board** opens a fresh room in a new tab. **↺ Reset** restores the sample board for everyone, after a confirmation |

## Project structure

```
app/
  page.jsx              Room bootstrap, Yjs ⇄ React Flow mirroring, toolbar, export/import
  layout.jsx            Root layout + global CSS
  globals.css           All styling (incl. cursors and carets)
components/
  MultiTypeNode.jsx     Custom node: title, type dropdown, content, notes (reads its Y.Map)
  TiptapEditor.jsx      Collaborative Tiptap editor + toolbar
  CollabText.jsx        <input>/<textarea> bound to a Y.Text (minimal diffs, caret kept in place)
  Presence.jsx          Remote cursors + online avatars (Yjs awareness)
lib/
  board.js              Node factory, sample board, import validation
  collab.js             Shared document layout, HTML ⇄ Y.XmlFragment, React hooks
  p2pProvider.js        Yjs provider over Trystero (sync + awareness protocol, peer tracking)
  useCollabSession.js   Y.Doc + IndexedDB + provider lifecycle
```

## Board file format (export / import)

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
        "notes": [{ "id": "note_1", "author": "Alice", "color": "#e11d48", "message": "Hi", "createdAt": "2026-10-14T10:00:00.000Z" }]
      }
    }
  ],
  "edges": [{ "id": "e1", "source": "node_a", "target": "node_b" }]
}
```

Files exported before co-op existed can still be imported.

## Implementation notes

- **Yjs is the source of truth.** React Flow's `nodes` state is a mirror that adds local-only view state (selection, measured size, an in-progress drag). Keystrokes inside a node don't re-render the canvas; only structure, position and type changes do.
- **Who seeds a room.** Only the browser that *creates* a room fills it with the starter board, so people joining never get duplicate nodes. A board saved in `localStorage` by the pre-co-op version is moved into your first new room.
- **Dragging and scrolling inside nodes.** Interactive elements use React Flow's `nodrag` class, and scrollable areas use `nowheel`.
- **Rendering.** Tiptap uses `immediatelyRender: false` and loads client-only. Trystero and y-indexeddb are imported dynamically inside effects.
