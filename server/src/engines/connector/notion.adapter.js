'use strict';

const { BaseAdapter, ConnectorState, saveConnectorState, getConnectorState } = require('./connector.framework');
const { authHeader, fetchJson, requireField, textFromRichText } = require('./connector.http');
const logger = require('../../lib/logger');

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

class NotionAdapter extends BaseAdapter {
  constructor() {
    super('notion', {
      displayName: 'Notion',
      description: 'Extract action items from your meeting notes and project specs.',
      icon: 'notion',
      scopes: ['read'],
    });
  }

  async connect(db, userId, credentials = {}) {
    logger.info('Connecting Notion', { userId });
    const tokenSet = await resolveNotionToken(credentials);
    const user = await notionFetch('/users/me', tokenSet.accessToken);

    const meta = {
      ...tokenSet,
      workspaceId: credentials.workspaceId || user.workspace_id || null,
      botId: credentials.botId || user.bot?.owner?.workspace || user.id || null,
      workspaceName: credentials.workspaceName || user.name || null,
      maxResults: Math.min(Math.max(parseInt(credentials.maxResults || '10', 10), 1), 25),
      connectedAt: new Date().toISOString(),
    };

    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, meta);
    return { success: true, workspace: meta.workspaceName || meta.workspaceId };
  }

  async disconnect(db, userId) {
    logger.info('Disconnecting Notion', { userId });
    await saveConnectorState(db, userId, this.name, ConnectorState.DISCONNECTED, {});
    return { success: true };
  }

  async getStatus(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    return state.state;
  }

  async sync(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    if (state.state !== ConnectorState.CONNECTED) throw new Error('Notion is not connected');

    logger.info('Syncing Notion', { userId });
    await saveConnectorState(db, userId, this.name, ConnectorState.SYNCING, state.meta);

    try {
      const maxResults = Math.min(Math.max(parseInt(state.meta.maxResults || '10', 10), 1), 25);
      const search = await notionFetch('/search', state.meta.accessToken, {
        method: 'POST',
        body: {
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: maxResults,
        },
      });

      const pages = [];
      for (const page of search.results || []) {
        pages.push(await toPageItem(page, state.meta.accessToken));
      }

      await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
        ...state.meta,
        lastSyncAt: new Date().toISOString(),
        lastSyncCount: pages.length,
      });

      return pages.filter(page => page.text);
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

async function resolveNotionToken(credentials) {
  if (credentials.authCode || credentials.code) return exchangeNotionAuthCode(credentials.authCode || credentials.code, credentials.redirectUri);
  return {
    accessToken: requireField(credentials.accessToken, 'Notion requires accessToken or authCode'),
  };
}

async function exchangeNotionAuthCode(code, redirectUri) {
  requireField(process.env.NOTION_CLIENT_ID, 'NOTION_CLIENT_ID is required for Notion OAuth code exchange', 500);
  requireField(process.env.NOTION_CLIENT_SECRET, 'NOTION_CLIENT_SECRET is required for Notion OAuth code exchange', 500);
  requireField(redirectUri || process.env.NOTION_REDIRECT_URI, 'redirectUri or NOTION_REDIRECT_URI is required for Notion OAuth code exchange', 400);

  const basic = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');
  const token = await fetchJson(`${NOTION_API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri || process.env.NOTION_REDIRECT_URI,
    }),
  });

  return {
    accessToken: token.access_token,
    workspaceId: token.workspace_id || null,
    workspaceName: token.workspace_name || null,
    botId: token.bot_id || null,
  };
}

async function notionFetch(path, accessToken, options = {}) {
  return fetchJson(`${NOTION_API}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...authHeader(accessToken),
      'Notion-Version': NOTION_VERSION,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function toPageItem(page, accessToken) {
  const title = getPageTitle(page) || 'Untitled Notion page';
  const blocks = await notionFetch(`/blocks/${page.id}/children?page_size=50`, accessToken).catch(() => ({ results: [] }));
  const lines = [];
  for (const block of blocks.results || []) {
    const line = blockToText(block);
    if (line) lines.push(line);
  }

  return {
    id: page.id,
    type: 'document',
    title,
    text: [title, ...lines].join('\n').trim(),
    metadata: {
      url: page.url || null,
      lastEditedTime: page.last_edited_time || null,
      createdTime: page.created_time || null,
    },
  };
}

function getPageTitle(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property.type === 'title') return textFromRichText(property.title);
  }
  return '';
}

function blockToText(block) {
  if (block.type === 'to_do') {
    const text = textFromRichText(block.to_do?.rich_text || []);
    return text ? `[${block.to_do.checked ? 'x' : ' '}] ${text}` : '';
  }
  const richText = block[block.type]?.rich_text;
  if (Array.isArray(richText)) return textFromRichText(richText);
  return '';
}

module.exports = new NotionAdapter();
