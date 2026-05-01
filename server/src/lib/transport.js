/**
 * ✦ HYBRID TRANSPORT
 *
 * Real-time push from server → client via WebSocket with SSE fallback.
 * Used by the observability engine, decision engine, and execution engine
 * to stream state changes, anomaly alerts, and trace updates.
 *
 * Architecture:
 *   Server → HybridTransport → (WebSocket | SSE) → Client
 *
 * Auto-negotiation:
 *   1. Client connects via WebSocket
 *   2. If WS fails (corporate proxy, mobile), falls back to SSE
 *   3. If SSE fails, falls back to long-polling
 *
 * Channel types:
 *   decisions   — decision engine updates
 *   traces      — observability trace stream
 *   anomalies   — anomaly detection alerts
 *   ripples     — propagation cascade events
 *   commands    — execution engine results
 *   items       — item state changes
 */
'use strict';

const { WebSocketServer } = require('ws');
const { v4: uuid } = require('uuid');
const jwt    = require('jsonwebtoken');
const logger = require('../lib/logger');

class HybridTransport {
  constructor() {
    this._wss       = null;
    this._clients   = new Map(); // userId → Set<{ ws?, res?, id, channels }>
    this._sseClients = new Map(); // userId → Set<{ res, id, channels }>
  }

  /**
   * Attach to an HTTP server. Call once at startup.
   */
  attach(server) {
    this._wss = new WebSocketServer({ server, path: '/ws' });

    this._wss.on('connection', (ws, req) => {
      const id = uuid();
      let userId = null;

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);

          if (msg.type === 'auth') {
            if (!msg.token) {
              ws.send(JSON.stringify({ type: 'error', message: 'auth token required' }));
              ws.close(4001, 'Unauthorized');
              return;
            }
            let decoded;
            try {
              decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
            } catch {
              ws.send(JSON.stringify({ type: 'error', message: 'invalid or expired token' }));
              ws.close(4001, 'Unauthorized');
              return;
            }
            userId = decoded.sub;
            this._registerClient(userId, { ws, id, channels: new Set(msg.channels || ['items']) });
            ws.send(JSON.stringify({ type: 'auth_ok', id, channels: msg.channels || ['items'] }));
            logger.info('WS client authenticated', { userId, id });
          }

          if (msg.type === 'subscribe') {
            const client = this._findClient(userId, id);
            if (client) {
              for (const ch of (msg.channels || [])) client.channels.add(ch);
              ws.send(JSON.stringify({ type: 'subscribed', channels: [...client.channels] }));
            }
          }

          if (msg.type === 'unsubscribe') {
            const client = this._findClient(userId, id);
            if (client) {
              for (const ch of (msg.channels || [])) client.channels.delete(ch);
            }
          }

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        if (userId) this._removeClient(userId, id);
        logger.info('WS client disconnected', { userId, id });
      });

      ws.on('error', (err) => {
        logger.warn('WS client error', { id, error: err.message });
        if (userId) this._removeClient(userId, id);
      });
    });

    logger.info('HybridTransport: WebSocket server attached at /ws');
  }

  /**
   * SSE endpoint handler (Express middleware).
   * Mount: app.get('/api/v1/stream', transport.sseHandler())
   */
  sseHandler() {
    return (req, res) => {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Auth required for SSE' });

      const id       = uuid();
      const channels = req.query.channels
        ? req.query.channels.split(',')
        : ['items'];

      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      res.write(`data: ${JSON.stringify({ type: 'connected', id, channels })}\n\n`);

      this._registerClient(userId, { res, id, channels: new Set(channels), sse: true });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        res.write(`:heartbeat ${Date.now()}\n\n`);
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeat);
        this._removeClient(userId, id);
        logger.info('SSE client disconnected', { userId, id });
      });
    };
  }

  /**
   * Send a message to all clients of a user subscribed to a channel.
   *
   * @param {string} userId
   * @param {string} channel  — 'decisions', 'traces', 'anomalies', etc.
   * @param {Object} payload
   */
  send(userId, channel, payload) {
    const clients = this._clients.get(userId);
    if (!clients) return;

    const message = JSON.stringify({ type: 'event', channel, data: payload, ts: Date.now() });
    const sseData = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of clients) {
      if (!client.channels.has(channel)) continue;

      try {
        if (client.ws && client.ws.readyState === 1) {
          client.ws.send(message);
        } else if (client.sse && client.res && !client.res.writableEnded) {
          client.res.write(sseData);
        }
      } catch (err) {
        logger.warn('Transport send error', { userId, clientId: client.id, error: err.message });
      }
    }
  }

  /**
   * Broadcast to all connected clients on a channel (admin broadcasts).
   */
  broadcast(channel, payload) {
    for (const [userId] of this._clients) {
      this.send(userId, channel, payload);
    }
  }

  /**
   * Get connection stats for monitoring.
   */
  getStats() {
    let wsCount  = 0;
    let sseCount = 0;

    for (const clients of this._clients.values()) {
      for (const client of clients) {
        if (client.ws)  wsCount++;
        if (client.sse) sseCount++;
      }
    }

    return {
      totalUsers:    this._clients.size,
      wsConnections: wsCount,
      sseConnections: sseCount,
      totalConnections: wsCount + sseCount,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _registerClient(userId, client) {
    if (!this._clients.has(userId)) this._clients.set(userId, new Set());
    this._clients.get(userId).add(client);
  }

  _removeClient(userId, clientId) {
    const clients = this._clients.get(userId);
    if (!clients) return;
    for (const client of clients) {
      if (client.id === clientId) {
        clients.delete(client);
        break;
      }
    }
    if (clients.size === 0) this._clients.delete(userId);
  }

  _findClient(userId, clientId) {
    const clients = this._clients.get(userId);
    if (!clients) return null;
    for (const client of clients) {
      if (client.id === clientId) return client;
    }
    return null;
  }
}

// Singleton
const transport = new HybridTransport();

module.exports = { transport, HybridTransport };
