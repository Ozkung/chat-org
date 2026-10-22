import mqtt from 'mqtt';
import { joinRoom } from 'trystero';

/*
 * Two interchangeable pipes that broadcast opaque byte messages to everyone in a room.
 * The provider sends every message through both; whichever arrives first wins and the
 * duplicate is dropped (see collabProvider.js).
 *
 *  RelayTransport  – public MQTT brokers over WebSocket. Connects in ~1s, works on any network.
 *                    Payloads are AES-GCM encrypted with a key derived from the room id, and the
 *                    topic is a hash, so the brokers never see the room id or board content.
 *  DirectTransport – WebRTC data channels via Trystero (Nostr relays only introduce peers).
 *                    Lowest latency once connected, but can take a while or fail on strict NATs.
 */

const list = (value, fallback) => {
  const items = (value || '').split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};

const BROKERS = list(process.env.NEXT_PUBLIC_MQTT_URLS, [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
]);
const NOSTR_RELAYS = list(process.env.NEXT_PUBLIC_NOSTR_RELAYS, null);

// Public brokers drop clients that publish oversized packets; bigger messages go peer-to-peer only.
const MAX_RELAY_BYTES = 200 * 1024;

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function deriveRoomSecrets(roomId) {
  const material = await crypto.subtle.importKey('raw', enc.encode(roomId), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('discussion-canvas-v1'), info: enc.encode(info) });
  const key = await crypto.subtle.deriveKey(hkdf('payload-key'), material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const topicBits = await crypto.subtle.deriveBits(hkdf('topic'), material, 128);
  return { key, topic: `discussion-canvas/v1/${toHex(topicBits)}` };
}

export class RelayTransport {
  constructor(roomId, { onMessage, onReady, onStatus }) {
    this.onMessage = onMessage;
    this.onReady = onReady;
    this.onStatus = onStatus;
    this.clients = [];
    this.queue = Promise.resolve(); // keep encryption/publish order stable
    this.destroyed = false;
    if (!globalThis.crypto?.subtle) throw new Error('WebCrypto unavailable (page must be served over HTTPS)');
    this.ready = deriveRoomSecrets(roomId)
      .then((secrets) => {
        if (this.destroyed) return;
        this.secrets = secrets;
        this.clients = BROKERS.map((url) => this.connect(url));
      })
      .catch((e) => console.warn('Relay transport failed to start:', e));
  }

  connect(url) {
    const client = mqtt.connect(url, {
      clientId: `dc_${Math.random().toString(16).slice(2, 14)}`,
      clean: true,
      keepalive: 30,
      connectTimeout: 6000,
      reconnectPeriod: 3000,
      protocolVersion: 4,
    });
    client.on('connect', () => {
      client.subscribe(this.secrets.topic, { qos: 0 }, (err) => {
        if (err) return;
        this.onStatus();
        this.onReady(); // (re)connected: ask everyone for anything we missed
      });
    });
    client.on('close', () => this.onStatus());
    client.on('error', () => {}); // reconnects automatically
    client.on('message', (_topic, payload) => this.receive(payload));
    return client;
  }

  get connected() {
    return this.clients.filter((c) => c.connected).length;
  }

  send(bytes) {
    this.queue = this.queue
      .then(async () => {
        if (this.destroyed || !this.secrets || this.connected === 0) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.secrets.key, bytes));
        const packet = new Uint8Array(iv.length + cipher.length);
        packet.set(iv);
        packet.set(cipher, iv.length);
        if (packet.length > MAX_RELAY_BYTES) return;
        for (const c of this.clients) if (c.connected) c.publish(this.secrets.topic, packet, { qos: 0 });
      })
      .catch(() => {});
  }

  async receive(payload) {
    if (!this.secrets || payload.length < 29) return;
    try {
      const data = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, this.secrets.key, data.subarray(12));
      if (!this.destroyed) this.onMessage(new Uint8Array(plain));
    } catch {
      /* not ours / tampered */
    }
  }

  destroy() {
    this.destroyed = true;
    this.clients.forEach((c) => c.end(true));
  }
}

export class DirectTransport {
  constructor(roomId, { onMessage, onReady, onStatus }) {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC unavailable');
    this.peers = new Set();
    this.room = joinRoom(
      {
        appId: 'discussion-canvas-v1',
        password: roomId, // encrypts the WebRTC offers passing through the Nostr relays
        ...(NOSTR_RELAYS ? { relayConfig: { urls: NOSTR_RELAYS, redundancy: NOSTR_RELAYS.length } } : {}),
      },
      `discussion-canvas:${roomId}`,
    );
    this.action = this.room.makeAction('y', { onMessage: (data) => onMessage(new Uint8Array(data)) });
    this.room.onPeerJoin = (peerId) => {
      this.peers.add(peerId);
      onStatus();
      onReady();
    };
    this.room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      onStatus();
    };
  }

  get connected() {
    return this.peers.size;
  }

  send(bytes) {
    if (this.peers.size) this.action.send(bytes).catch(() => {});
  }

  destroy() {
    this.room.leave().catch(() => {});
  }
}
