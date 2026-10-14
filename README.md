# 🧭 Discussion Canvas

A whiteboard for meetings where each topic is a node. You can drag nodes, connect them, and switch what a node holds (plain text, an image, rich text, or JSON). Every node has its own **💬 Notes** thread for team comments.

**Live co-op:** share the room link, and everyone edits the same board at the same time. You see each other's mouse pointers, who is online, and each other's carets inside rich-text nodes. There is no account and no database. Edits sync through [Yjs](https://yjs.dev) over two paths at once: encrypted messages through free public MQTT brokers (connects in about a second, works on any network) and direct WebRTC between browsers (lowest latency). Each browser also keeps its own copy in IndexedDB.

## Tech stack

- **Next.js 16** (App Router, client components)
- **@xyflow/react 12** (React Flow, MIT): canvas, edges, MiniMap, Controls
- **@tiptap/react 3** + StarterKit + Collaboration / CollaborationCaret: rich text inside nodes
- **Yjs** (CRDT) + **mqtt.js** (encrypted relay over public brokers) + **Trystero** (direct WebRTC, peers found via Nostr relays) + **y-indexeddb** (local copy)
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
                  ┌─── public MQTT brokers (EMQX, HiveMQ, Mosquitto) ───┐
Browser A ──AES──►│   relay path: ~1 s to connect, works on any network   │──AES──► Browser B
                  └───────────────────────────────────────────────────────┘
Browser A ◄═══════ direct WebRTC path (fastest; peers found via Nostr relays) ═══════► Browser B
   │                                                                          │
IndexedDB (local copy per room)                                IndexedDB (local copy per room)
```

- **Two paths, first one wins.** Every edit and cursor move goes out on both paths. Each message carries an id, so the copy that arrives second is dropped. If one path is down or blocked, the other keeps working.
- **Relay path.** Messages are encrypted (AES-GCM) with a key derived from the room id, and the MQTT topic is a hash, so the brokers never see your board or room link. Cursor updates on this path are batched to about 16 per second. Messages over 200 KB (very large boards) only travel on the direct path.
- **Direct path.** Trystero introduces browsers to each other through public Nostr relays; after that, data flows browser to browser.
- **Self-healing.** Every 20 s, and whenever a connection comes back, browsers compare what they have and send each other anything that's missing.
- **Merging.** Yjs merges simultaneous edits. Titles, text, URLs and JSON merge character by character. Rich text merges as a document. Notes are an append-only list. Node position and type are last-writer-wins.
- **Persistence.** A room survives as long as **anyone** who has opened it still has their local copy. When someone rejoins, their copy merges with everyone else's. To keep a durable backup, use **⬇ Export**.
- **Status dot.** Green = connected to at least one relay server or peer; amber = still connecting (edits are saved locally and sync once connected). Hover it for counts.

### Limitations

1. **Free public services.** The MQTT brokers and Nostr relays are free community services with no uptime guarantee. Using several of each means one outage doesn't stop sync.
2. **Access control.** Anyone with the room link can join and edit, so treat the link like a password. Room ids are 16 random hex characters.
3. **Custom servers (optional).** In Vercel's environment variables, set `NEXT_PUBLIC_MQTT_URLS=wss://broker.one/mqtt,wss://broker.two/mqtt` and/or `NEXT_PUBLIC_NOSTR_RELAYS=wss://relay.one,wss://relay.two`, then redeploy.

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
  collabProvider.js     Yjs provider: sync + awareness protocol, de-duplication, periodic resync
  transports.js         Encrypted MQTT relay transport + direct WebRTC (Trystero) transport
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
- **Rendering.** Tiptap uses `immediatelyRender: false` and loads client-only. The sync provider and y-indexeddb are imported dynamically inside effects.
