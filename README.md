# 🧭 Discussion Canvas

A whiteboard for meetings where each topic is a node. You can drag nodes, connect them, and switch what a node holds (plain text, an image, rich text, or JSON). Every node has its own **💬 Notes** chat, which can include photos taken with your phone or picked from your library.

People sign in with **Google**. Boards are saved on the server and edited live together, with each other's cursors, avatars of who is online, and shared rich-text editing.

## Tech stack

| Concern | Choice |
| --- | --- |
| App | **Next.js 16** (App Router, server actions) on **Vercel** |
| Sign-in | **Auth.js v5** with the **Google** provider and the Prisma adapter (JWT sessions) |
| Users, boards, membership | **PostgreSQL** via **Prisma 7** (Neon or Prisma Postgres from Vercel → Storage) |
| Realtime board content | **Liveblocks** + **Yjs** (`@liveblocks/yjs`). Liveblocks stores the content |
| Canvas | **@xyflow/react 12** (React Flow) |
| Rich text | **Tiptap 3** with Collaboration and CollaborationCaret |
| Photos in notes | **Vercel Blob** (private), served only to board members |

## How it works

```
Browser ── Google sign-in ──► Auth.js ──► Prisma ──► Postgres  (users, boards, members)
   │
   ├── POST /api/liveblocks-auth ──► checks membership in Postgres ──► Liveblocks token
   ├══ Liveblocks room (Yjs) ══ nodes, edges, text, notes, cursors, presence
   └── POST /api/upload / GET /api/files/… ──► checks membership ──► Vercel Blob (private)
```

### Permissions
- **Board owner:** renames the board, chooses what the share link allows, and deletes the board (which also deletes its Liveblocks room and photos).
- **Share link:** "Anyone with the link can edit / view", or "Only current members". People must sign in with Google first. Opening a link adds the board to that person's list with the matching role.
- **Viewers:** see everything live, including cursors, but can't change anything. Liveblocks enforces this with a read-only token, and the UI hides the editing controls.
- **Notes:** authors can delete their own notes; the owner can delete any note.

### Photos in notes
- Tap **📷** in any node's notes. Phones offer *Take photo* or *Photo library*. You can also paste a screenshot into the note field.
- Images are resized in the browser to at most 1600 px (JPEG) before upload, which keeps them small. The upload limit is 4 MB.
- Files are stored **privately** in Vercel Blob and streamed through `/api/files/…`, which checks that the viewer is signed in and a member of that board. Image links are useless to anyone else.

## Deploy on Vercel

1. **Database:** Vercel → your project → **Storage** → create **Neon** (or Prisma Postgres) and connect it. This adds `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`).
2. **Photos:** Storage → create a **Blob** store and connect it. This adds `BLOB_READ_WRITE_TOKEN`.
3. **Google OAuth:** in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an *OAuth client ID* of type *Web application*:
   - Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
   - If the consent screen is in *Testing* mode, add your testers' emails, or publish the app.
4. **Liveblocks:** create a project at [liveblocks.io](https://liveblocks.io) and copy its **secret key**.
5. **Environment variables** (Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `AUTH_SECRET` | output of `npx auth secret` or `openssl rand -base64 32` |
   | `AUTH_GOOGLE_ID` | Google OAuth client ID |
   | `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
   | `LIVEBLOCKS_SECRET_KEY` | `sk_…` |
   | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN` | added by steps 1–2 |

6. **Redeploy.** `npm run build` runs `prisma migrate deploy` automatically, so the tables are created on the first deploy.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL etc.
npm run dev                  # http://localhost:3000
```

**Fully offline dev (no Google, no Liveblocks account):**
```bash
npm run liveblocks:dev       # local Liveblocks server on :1153
# in .env.local:
#   AUTH_DEV_LOGIN=1                                  → name-only sign-in (never active on Vercel)
#   LIVEBLOCKS_SECRET_KEY=sk_localdev
#   LIVEBLOCKS_BASE_URL=http://localhost:1153
#   NEXT_PUBLIC_LIVEBLOCKS_BASE_URL=http://localhost:1153
#   (leave BLOB_READ_WRITE_TOKEN empty → photos go to ./.uploads)
npx prisma migrate deploy    # create tables in your DATABASE_URL
npm run dev
```

**Schema changes:** edit `prisma/schema.prisma`, then run `npm run db:migrate`. This creates a new migration in `prisma/migrations/`; commit it.

## Features

| Area | What it does |
| --- | --- |
| Boards | "My boards" dashboard; create, rename (owner), delete (owner) or leave (member) |
| Canvas | Drag, pan, zoom, connect handles (large, easy to grab), MiniMap colored by node type, zoom controls |
| Resizable nodes | Drag a selected node's edges or corners. Minimum 300 × 600, default 320 × 600. Size syncs to everyone, and content stretches to fill |
| Node types | 📄 Text · 🖼️ Image URL · ✍️ Tiptap rich text · 📊 JSON (validation + Format) |
| Live co-editing | Text fields merge character by character; Tiptap merges as a document, with named carets |
| Presence | Live cursors with names, avatars (Google photo) of who's online, connection status |
| Notes chat | Per-node thread with author, time, text and photos |
| Export / Import | Download a board as `.json`; importing replaces the board for everyone (after confirmation). **✨ Sample** loads a demo board |
| Mobile | Compact header and bottom toolbar on phones; camera upload in notes |

## Project structure

```
app/
  page.jsx                     "My boards" dashboard (server component)
  signin/page.jsx              Google sign-in (+ local dev login)
  b/[roomId]/page.jsx          Board page: auth + access check, then the canvas
  actions.js                   Server actions: create / rename / share settings / delete or leave
  api/auth/[...nextauth]/      Auth.js routes
  api/liveblocks-auth/         Issues Liveblocks tokens after checking membership
  api/upload/                  Photo upload for notes
  api/files/[...path]/         Streams stored photos to board members only
auth.js                        Auth.js config (Google, Prisma adapter, dev login)
components/
  BoardCanvas.jsx              Canvas, toolbar, share panel, Yjs ⇄ React Flow mirroring
  MultiTypeNode.jsx            Node: title, type, content, notes chat with photos
  TiptapEditor.jsx             Collaborative Tiptap editor
  CollabText.jsx               <input>/<textarea> bound to a Y.Text
  Presence.jsx                 Remote cursors + online avatars
  BoardListItem.jsx            Dashboard row
lib/
  access.js                    Board roles and link access rules
  board.js                     Node factory, sample board, import validation, ids, colors
  collab.js                    Yjs document layout, HTML ⇄ Y.XmlFragment, hooks
  useCollabSession.js          Liveblocks room + Yjs provider lifecycle
  image.js                     Client-side resize + upload
  storage.js                   Vercel Blob (private) / local disk storage
  prisma.js, liveblocks-server.js
prisma/schema.prisma           User, Account, Session, Board, BoardMember
prisma/migrations/             SQL migrations (applied on build)
```

## Board file format (export / import)

```json
{
  "version": 1,
  "title": "Sprint review",
  "nodes": [
    {
      "id": "node_ab12cd34",
      "type": "multiType",
      "position": { "x": 0, "y": 0 },
      "data": {
        "title": "Topic",
        "contentType": "text | image | tiptap | json",
        "text": "", "imageUrl": "", "html": "<p></p>", "json": "{}",
        "notes": [{ "id": "note_1", "authorId": "…", "author": "Alice", "color": "#e11d48", "message": "Hi",
                    "image": { "url": "/api/files/boards/…/….jpg", "width": 1600, "height": 900 },
                    "createdAt": "2026-10-22T10:00:00.000Z" }]
      }
    }
  ],
  "edges": [{ "id": "e1", "source": "node_a", "target": "node_b" }]
}
```

Photos in an export are links to the original board. They only load for members of that board.
