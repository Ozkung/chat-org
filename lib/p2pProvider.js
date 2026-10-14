import { ObservableV2 } from 'lib0/observable';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { joinRoom, getRelaySockets } from 'trystero';

const APP_ID = 'discussion-canvas-v1';

// Optional override, e.g. NEXT_PUBLIC_NOSTR_RELAYS="wss://relay.one,wss://relay.two"
const RELAY_URLS = (process.env.NEXT_PUBLIC_NOSTR_RELAYS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Yjs provider over Trystero (WebRTC, with public Nostr relays used only to introduce peers).
 * No server or account: relays carry encrypted connection offers, board data flows peer-to-peer.
 *
 * Emits: 'status' ({ relays }) and 'peers' ({ peers }).
 */
export class TrysteroProvider extends ObservableV2 {
  constructor(roomName, doc, { password, awareness = new awarenessProtocol.Awareness(doc) } = {}) {
    super();
    this.doc = doc;
    this.awareness = awareness;
    this.peerClients = new Map(); // peerId -> Set of awareness clientIds seen from that peer
    this.destroyed = false;

    this.room = joinRoom(
      {
        appId: APP_ID,
        password, // encrypts the WebRTC offers that pass through the public relays
        ...(RELAY_URLS.length ? { relayConfig: { urls: RELAY_URLS, redundancy: RELAY_URLS.length } } : {}),
      },
      roomName,
    );

    this.syncAction = this.room.makeAction('y-sync', { onMessage: (data, { peerId }) => this.onSync(data, peerId) });
    this.awarenessAction = this.room.makeAction('y-aware', {
      onMessage: (data, { peerId }) => this.onAwareness(data, peerId),
    });

    this.room.onPeerJoin = (peerId) => {
      this.peerClients.set(peerId, new Set());
      // Exchange state vectors; each side answers with whatever the other is missing.
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, doc);
      this.send(this.syncAction, encoder, peerId);
      this.sendAwareness([...awareness.getStates().keys()], peerId);
      this.emitPeers();
    };

    this.room.onPeerLeave = (peerId) => {
      const clients = this.peerClients.get(peerId);
      this.peerClients.delete(peerId);
      if (clients?.size) awarenessProtocol.removeAwarenessStates(awareness, [...clients], this);
      this.emitPeers();
    };

    this.onDocUpdate = (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      this.send(this.syncAction, encoder);
    };
    doc.on('update', this.onDocUpdate);

    this.onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      this.sendAwareness([...added, ...updated, ...removed]);
    };
    awareness.on('update', this.onAwarenessUpdate);

    this.onUnload = () => awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], 'window unload');
    window.addEventListener('beforeunload', this.onUnload);
    window.addEventListener('pagehide', this.onUnload); // mobile Safari skips beforeunload

    // Report how many relays are reachable, so the UI can tell "offline" from "alone in the room".
    this.statusTimer = setInterval(() => this.emitStatus(), 2000);
    this.emitStatus();
  }

  send(action, encoder, target) {
    if (this.peerClients.size === 0) return;
    action.send(encoding.toUint8Array(encoder), target ? { target } : undefined).catch(() => {});
  }

  sendAwareness(clients, target) {
    if (!clients.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    this.send(this.awarenessAction, encoder, target);
  }

  onSync(data, peerId) {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
    if (encoding.length(reply) > 0) this.send(this.syncAction, reply, peerId);
  }

  onAwareness(data, peerId) {
    const update = decoding.readVarUint8Array(decoding.createDecoder(new Uint8Array(data)));
    // Remember which awareness clients live behind this peer, to clear them when it leaves.
    const clients = this.peerClients.get(peerId);
    const dec = decoding.createDecoder(update);
    for (let i = decoding.readVarUint(dec); i > 0; i--) {
      clients?.add(decoding.readVarUint(dec));
      decoding.readVarUint(dec); // clock
      decoding.readVarString(dec); // state JSON
    }
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
  }

  emitPeers() {
    this.emit('peers', [{ peers: this.peerClients.size }]);
  }

  emitStatus() {
    const sockets = Object.values(getRelaySockets() || {});
    const relays = sockets.filter((s) => s?.readyState === WebSocket.OPEN).length;
    this.emit('status', [{ relays }]);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.statusTimer);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('pagehide', this.onUnload);
    // Tell peers we're gone before unhooking the listeners that broadcast it.
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider destroy');
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.room.leave().catch(() => {});
    super.destroy();
  }
}
