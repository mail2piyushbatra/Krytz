'use strict';

const { BaseAdapter, ConnectorState, saveConnectorState, getConnectorState } = require('./connector.framework');
const { authHeader, fetchJson, getHeader, normalizeExpiresAt, requireField } = require('./connector.http');
const logger = require('../../lib/logger');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

class GmailAdapter extends BaseAdapter {
  constructor() {
    super('gmail', {
      displayName: 'Gmail',
      description: 'Find actionable items and important requests buried in your inbox.',
      icon: 'gmail',
      scopes: ['read'],
    });
  }

  async connect(db, userId, credentials = {}) {
    logger.info('Connecting Gmail', { userId });
    const tokenSet = await resolveGoogleTokens(credentials);
    const profile = await fetchJson(`${GMAIL_API}/users/me/profile`, {
      headers: authHeader(tokenSet.accessToken),
    });

    const meta = {
      ...tokenSet,
      email: credentials.email || profile.emailAddress,
      historyId: profile.historyId,
      query: credentials.query || 'newer_than:7d (is:unread OR label:inbox)',
      maxResults: Math.min(Math.max(parseInt(credentials.maxResults || '10', 10), 1), 25),
      connectedAt: new Date().toISOString(),
    };

    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, meta);
    return { success: true, email: meta.email };
  }

  async disconnect(db, userId) {
    logger.info('Disconnecting Gmail', { userId });
    await saveConnectorState(db, userId, this.name, ConnectorState.DISCONNECTED, {});
    return { success: true };
  }

  async getStatus(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    return state.state;
  }

  async sync(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    if (state.state !== ConnectorState.CONNECTED) throw new Error('Gmail is not connected');

    logger.info('Syncing Gmail', { userId });
    await saveConnectorState(db, userId, this.name, ConnectorState.SYNCING, state.meta);

    try {
      const meta = await ensureGoogleAccessToken(db, userId, this.name, state.meta);
      const query = encodeURIComponent(meta.query || 'newer_than:7d (is:unread OR label:inbox)');
      const maxResults = Math.min(Math.max(parseInt(meta.maxResults || '10', 10), 1), 25);
      const list = await fetchJson(`${GMAIL_API}/users/me/messages?q=${query}&maxResults=${maxResults}`, {
        headers: authHeader(meta.accessToken),
      });

      const messages = [];
      for (const message of list.messages || []) {
        const detail = await fetchJson(`${GMAIL_API}/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
          headers: authHeader(meta.accessToken),
        });
        messages.push(toEmailItem(detail));
      }

      await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
        ...meta,
        lastSyncAt: new Date().toISOString(),
        lastSyncCount: messages.length,
      });

      return messages;
    } catch (err) {
      await saveConnectorState(db, userId, this.name, ConnectorState.ERROR, {
        ...state.meta,
        lastError: err.message,
        lastErrorAt: new Date().toISOString(),
      });
      throw err;
    }
  }
}

function toEmailItem(message) {
  const headers = message.payload?.headers || [];
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const from = getHeader(headers, 'From');
  const date = getHeader(headers, 'Date');
  return {
    id: message.id,
    type: 'email',
    title: subject,
    text: [subject, message.snippet].filter(Boolean).join('\n\n'),
    isRead: !(message.labelIds || []).includes('UNREAD'),
    requiresAction: true,
    metadata: {
      from,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      labels: message.labelIds || [],
      threadId: message.threadId,
    },
  };
}

async function resolveGoogleTokens(credentials) {
  if (credentials.authCode || credentials.code) return exchangeGoogleAuthCode(credentials.authCode || credentials.code, credentials.redirectUri);
  const accessToken = requireField(credentials.accessToken, 'Gmail requires accessToken or authCode');
  return {
    accessToken,
    refreshToken: credentials.refreshToken || null,
    expiresAt: credentials.expiresAt || null,
  };
}

async function exchangeGoogleAuthCode(code, redirectUri) {
  requireField(process.env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID is required for Google OAuth code exchange', 500);
  requireField(process.env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET is required for Google OAuth code exchange', 500);
  requireField(redirectUri || process.env.GOOGLE_REDIRECT_URI, 'redirectUri or GOOGLE_REDIRECT_URI is required for Google OAuth code exchange', 400);

  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const token = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresAt: normalizeExpiresAt(token.expires_in),
  };
}

async function ensureGoogleAccessToken(db, userId, adapterName, meta) {
  if (meta.accessToken && (!meta.expiresAt || Number(meta.expiresAt) > Date.now())) return meta;
  if (!meta.refreshToken) return meta;
  requireField(process.env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID is required to refresh Google tokens', 500);
  requireField(process.env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET is required to refresh Google tokens', 500);

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: meta.refreshToken,
    grant_type: 'refresh_token',
  });

  const token = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const next = {
    ...meta,
    accessToken: token.access_token,
    expiresAt: normalizeExpiresAt(token.expires_in),
  };
  await saveConnectorState(db, userId, adapterName, ConnectorState.CONNECTED, next);
  return next;
}

module.exports = new GmailAdapter();
