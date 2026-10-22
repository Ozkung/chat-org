import { ObservableV2 } from 'lib0/observable';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { DirectTransport, RelayTransport } from './transports';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const ID_BYTES = 8;
const HEADER = 1 + ID_BYTES * 3; // type | message id | sender | target (zeros = everyone)
const NOBODY = new Uint8Array(ID_BYTES);
const RESYNC_MS = 20000; // periodic state-vector exchange heals any dropped relay message
const RELAY_AWARENESS_MS = 60; // cursor updates over the relay are coalesced to ~16/s

const OFFLINE = { connected: 0, send() {}, destroy() {}, queue: Promise.resolve() };
function createTransport(Transport, roomId, handlers) {
  try {
    return new Transport(roomId, handlers);
  } catch (e) {
    console.warn(`${Transport.name} unavailable:`, e);
    return OFFLINE;
  }
}

const randomId = () => crypto.getRandomValues(new Uint8Array(ID_BYTES));
const idKey = (bytes) => String.fromCharCode(...bytes);
const sameId = (a, b) => a.every((v, i) => v === b[i]);

/**
 * Yjs provider that keeps a room in sync over two transports at once (see transports.js).
 * Uses the standard y-protocols sync + awareness messages, so it behaves like y-webrtc/y-websocket.
 * Emits 'status' with { relays, peers }.
 */
export class CollabProvider extends ObservableV2 {
  constructor(roomId, doc, { awareness = new awarenessProtocol.Awareness(doc) } = {}) {
    super();
    this.doc = doc;
    this.awareness = awareness;
    this.selfId = randomId();
    this.knownSenders = new Set();
    this.seen = new Set();
    this.seenOrder = [];
    this.pendingRelayAwareness = new Set();
    this.relayAwarenessTimer = null;

    const handlers = {
      onMessage: (bytes) => this.receive(bytes),
      onReady: () => this.hello(),
      onStatus: () => this.emitStatus(),
    };
    // Each transport is optional: a browser without WebRTC or WebCrypto still joins over the other.
    this.relay = createTransport(RelayTransport, roomId, handlers);
    this.direct = createTransport(DirectTransport, roomId, handlers);

    this.onDocUpdate = (update, origin) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      this.send(MSG_SYNC, encoding.toUint8Array(encoder));
    };
    doc.on('update', this.onDocUpdate);

    this.onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === this) return;
      const changed = [...added, ...updated, ...removed];
      // Direct peers get every frame; the relay gets a coalesced update unless someone left.
      this.send(MSG_AWARENESS, this.encodeAwareness(changed), NOBODY, { relay: removed.length > 0 });
      if (!removed.length) this.queueRelayAwareness(changed);
    };
    awareness.on('update', this.onAwarenessUpdate);

    this.onUnload = () => awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], 'window unload');
    window.addEventListener('beforeunload', this.onUnload);
    window.addEventListener('pagehide', this.onUnload); // mobile Safari skips beforeunload

    this.resyncTimer = setInterval(() => this.hello(false), RESYNC_MS);
  }

  /* ----- outgoing ----- */

  send(type, payload, target = NOBODY, { relay = true, direct = true } = {}) {
    const bytes = new Uint8Array(HEADER + payload.length);
    bytes[0] = type;
    const msgId = randomId();
    bytes.set(msgId, 1);
    bytes.set(this.selfId, 1 + ID_BYTES);
    bytes.set(target, 1 + ID_BYTES * 2);
    bytes.set(payload, HEADER);
    this.markSeen(idKey(msgId));
    if (relay) this.relay.send(bytes);
    if (direct) this.direct.send(bytes);
  }

  encodeAwareness(clients) {
    return awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients);
  }

  queueRelayAwareness(clients) {
    clients.forEach((c) => this.pendingRelayAwareness.add(c));
    if (this.relayAwarenessTimer) return;
    this.relayAwarenessTimer = setTimeout(() => {
      this.relayAwarenessTimer = null;
      const pending = [...this.pendingRelayAwareness].filter((c) => this.awareness.getStates().has(c));
      this.pendingRelayAwareness.clear();
      if (pending.length) this.send(MSG_AWARENESS, this.encodeAwareness(pending), NOBODY, { direct: false });
    }, RELAY_AWARENESS_MS);
  }

  // Broadcast our state vector (+ presence); everyone answers with what we're missing.
  hello(withAwareness = true) {
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(MSG_SYNC, encoding.toUint8Array(encoder));
    if (withAwareness) this.send(MSG_AWARENESS, this.encodeAwareness([...this.awareness.getStates().keys()]));
  }

  /* ----- incoming ----- */

  markSeen(key) {
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > 5000) this.seen.delete(this.seenOrder.shift());
  }

  receive(bytes) {
    if (this.destroyed || bytes.length < HEADER) return;
    const msgKey = idKey(bytes.subarray(1, 1 + ID_BYTES));
    if (this.seen.has(msgKey)) return; // duplicate from the other transport or another broker
    this.markSeen(msgKey);

    const sender = bytes.slice(1 + ID_BYTES, 1 + ID_BYTES * 2);
    const target = bytes.subarray(1 + ID_BYTES * 2, HEADER);
    if (sameId(sender, this.selfId)) return;
    if (!sameId(target, NOBODY) && !sameId(target, this.selfId)) return;
    const payload = bytes.subarray(HEADER);

    if (bytes[0] === MSG_SYNC) {
      const decoder = decoding.createDecoder(payload);
      const syncType = decoding.peekVarUint(decoder);
      const reply = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
      if (encoding.length(reply) > 0) this.send(MSG_SYNC, encoding.toUint8Array(reply), sender);

      const senderKey = idKey(sender);
      if (syncType === syncProtocol.messageYjsSyncStep1 && !this.knownSenders.has(senderKey)) {
        // New peer: also ask them for anything we don't have, and introduce ourselves.
        this.knownSenders.add(senderKey);
        const step1 = encoding.createEncoder();
        syncProtocol.writeSyncStep1(step1, this.doc);
        this.send(MSG_SYNC, encoding.toUint8Array(step1), sender);
        this.send(MSG_AWARENESS, this.encodeAwareness([...this.awareness.getStates().keys()]), sender);
      }
    } else if (bytes[0] === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, this);
    }
  }

  emitStatus() {
    this.emit('status', [{ relays: this.relay.connected, peers: this.direct.connected }]);
  }

  destroy() {
    if (this.destroyed) return;
    // Tell peers we're gone before unhooking the listeners that broadcast it.
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider destroy');
    this.destroyed = true;
    clearInterval(this.resyncTimer);
    clearTimeout(this.relayAwarenessTimer);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('pagehide', this.onUnload);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    // Let the goodbye flush through the relay's async encryption queue before disconnecting.
    const relay = this.relay;
    relay.queue.finally(() => relay.destroy());
    this.direct.destroy();
    super.destroy();
  }
}
