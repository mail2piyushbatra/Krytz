'use strict';

const { BaseAdapter, ConnectorState, saveConnectorState, getConnectorState } = require('./connector.framework');
const { authHeader, fetchJson, normalizeExpiresAt, requireField } = require('./connector.http');
const logger = require('../../lib/logger');

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

class GoogleCalendarAdapter extends BaseAdapter {
  constructor() {
    super('google_calendar', {
      displayName: 'Google Calendar',
      description: 'Sync upcoming events and extract action items from meeting notes.',
      icon: 'calendar',
      scopes: ['read'],
    });
  }

  async connect(db, userId, credentials = {}) {
    logger.info('Connecting Google Calendar', { userId });
    const tokenSet = await resolveGoogleTokens(credentials);
    const calendarId = credentials.calendarId || 'primary';
    const calendar = await fetchJson(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`, {
      headers: authHeader(tokenSet.accessToken),
    });

    const meta = {
      ...tokenSet,
      calendarId,
      calendarSummary: calendar.summary,
      email: credentials.email || calendar.id,
      daysAhead: Math.min(Math.max(parseInt(credentials.daysAhead || '14', 10), 1), 60),
      maxResults: Math.min(Math.max(parseInt(credentials.maxResults || '20', 10), 1), 50),
      connectedAt: new Date().toISOString(),
    };

    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, meta);
    return { success: true, calendar: calendar.summary || calendar.id };
  }

  async disconnect(db, userId) {
    logger.info('Disconnecting Google Calendar', { userId });
    await saveConnectorState(db, userId, this.name, ConnectorState.DISCONNECTED, {});
    return { success: true };
  }

  async getStatus(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    return state.state;
  }

  async sync(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    if (state.state !== ConnectorState.CONNECTED) throw new Error('Google Calendar is not connected');

    logger.info('Syncing Google Calendar', { userId });
    await saveConnectorState(db, userId, this.name, ConnectorState.SYNCING, state.meta);

    try {
      const meta = await ensureGoogleAccessToken(db, userId, this.name, state.meta);
      const now = new Date();
      const end = new Date(now.getTime() + Number(meta.daysAhead || 14) * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(Math.min(Math.max(parseInt(meta.maxResults || '20', 10), 1), 50)),
      });
      const calendarId = encodeURIComponent(meta.calendarId || 'primary');
      const result = await fetchJson(`${CALENDAR_API}/calendars/${calendarId}/events?${params.toString()}`, {
        headers: authHeader(meta.accessToken),
      });

      const events = (result.items || []).filter(event => event.status !== 'cancelled').map(toEventItem);
      await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
        ...meta,
        lastSyncAt: new Date().toISOString(),
        lastSyncCount: events.length,
      });

      return events;
    } catch (err) {
      await saveConnectorState(db, userId, this.name, ConnectorState.ERROR, {
        ...state.meta,
        lastError: err.message,
        lastErrorAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  async createEvent(db, userId, payload = {}) {
    const state = await getConnectorState(db, userId, this.name);
    if (state.state !== ConnectorState.CONNECTED) throw new Error('Google Calendar is not connected');

    const meta = await ensureGoogleAccessToken(db, userId, this.name, state.meta);
    const calendarId = encodeURIComponent(payload.calendarId || meta.calendarId || 'primary');
    const event = normalizeCalendarEvent(payload);
    const created = await fetchJson(`${CALENDAR_API}/calendars/${calendarId}/events`, {
      method: 'POST',
      headers: authHeader(meta.accessToken),
      body: JSON.stringify(event),
    });

    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
      ...meta,
      lastActionAt: new Date().toISOString(),
      lastAction: 'create_event',
    });

    return {
      eventId: created.id,
      htmlLink: created.htmlLink || null,
      summary: created.summary,
      start: created.start,
      end: created.end,
    };
  }
}

function toEventItem(event) {
  const start = event.start?.dateTime || event.start?.date || null;
  const end = event.end?.dateTime || event.end?.date || null;
  const attendeeEmails = (event.attendees || []).map(a => a.email).filter(Boolean);
  const summary = event.summary || '(untitled event)';
  return {
    id: event.id,
    type: 'event',
    title: summary,
    text: [summary, event.description, event.location ? `Location: ${event.location}` : ''].filter(Boolean).join('\n\n'),
    status: event.status,
    metadata: {
      startTime: start,
      endTime: end,
      attendees: attendeeEmails,
      organizer: event.organizer?.email || null,
      htmlLink: event.htmlLink || null,
      updated: event.updated || null,
    },
  };
}

function normalizeCalendarEvent(payload) {
  const summary = requireField(payload.summary || payload.title, 'summary is required');
  const start = normalizeDateTime(payload.startTime || payload.start, 'startTime');
  const end = normalizeDateTime(payload.endTime || payload.end, 'endTime');
  const timeZone = payload.timeZone || payload.timezone || 'UTC';
  const attendees = Array.isArray(payload.attendees)
    ? payload.attendees.map(attendee => typeof attendee === 'string' ? { email: attendee } : attendee).filter(attendee => attendee?.email)
    : [];

  return {
    summary,
    description: payload.description || '',
    location: payload.location || '',
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    attendees,
  };
}

function normalizeDateTime(value, fieldName) {
  requireField(value, `${fieldName} is required`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${fieldName} must be a valid date`);
    err.status = 400;
    throw err;
  }
  return date.toISOString();
}

function resolveGoogleTokens(credentials) {
  if (credentials.authCode || credentials.code) return exchangeGoogleAuthCode(credentials.authCode || credentials.code, credentials.redirectUri);
  const accessToken = requireField(credentials.accessToken, 'Google Calendar requires accessToken or authCode');
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

module.exports = new GoogleCalendarAdapter();
