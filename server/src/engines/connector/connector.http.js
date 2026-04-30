'use strict';

function requireField(value, message, status = 400) {
  if (value === undefined || value === null || value === '') {
    const err = new Error(message);
    err.status = status;
    throw err;
  }
  return value;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = body?.error_description || body?.error?.message || body?.message || body?.error || `${res.status} ${res.statusText}`;
    const err = new Error(String(message));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function safeJson(text) {
  try { return JSON.parse(text); }
  catch (_) { return { raw: text }; }
}

function authHeader(token) {
  return { Authorization: `Bearer ${requireField(token, 'accessToken is required')}` };
}

function normalizeExpiresAt(expiresInSeconds) {
  if (!expiresInSeconds) return null;
  return Date.now() + Math.max(0, Number(expiresInSeconds) - 60) * 1000;
}

function redactConnectorMeta(meta = {}) {
  const redacted = { ...meta };
  for (const key of ['accessToken', 'refreshToken', 'authCode', 'code']) {
    if (redacted[key]) redacted[key] = 'stored';
  }
  return redacted;
}

function getHeader(headers = [], name) {
  const found = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

function textFromRichText(parts = []) {
  return parts.map(part => part.plain_text || part.text?.content || '').join('').trim();
}

module.exports = {
  authHeader,
  fetchJson,
  getHeader,
  normalizeExpiresAt,
  redactConnectorMeta,
  requireField,
  textFromRichText,
};
