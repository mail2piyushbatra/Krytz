import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import db from '../src/lib/db';
import gmailAdapter from '../src/engines/connector/gmail.adapter';
import notionAdapter from '../src/engines/connector/notion.adapter';

// Mock global fetch instead of the module
const originalFetch = global.fetch;

const describeLive = process.env.KRYTZ_RUN_LIVE_API_TESTS === 'true' ? describe : describe.skip;
const BASE = 'http://localhost:8301';

describeLive('External Connector Integrations', () => {
  let token = '';
  let userId = '';

  beforeAll(async () => {
    // Override global.fetch
    global.fetch = vi.fn(async (url, options) => {
      const respond = (data) => ({ ok: true, text: async () => JSON.stringify(data) });

      // Mock Gmail API responses
      if (url.includes('gmail.googleapis.com/gmail/v1/users/me/profile')) {
        return respond({ emailAddress: 'test@gmail.com', historyId: '12345' });
      }
      if (url.includes('gmail.googleapis.com/gmail/v1/users/me/messages?q=')) {
        return respond({ messages: [{ id: 'msg1', threadId: 'thread1' }] });
      }
      if (url.includes('gmail.googleapis.com/gmail/v1/users/me/messages/msg1')) {
        return respond({
          id: 'msg1',
          threadId: 'thread1',
          snippet: 'Can you please review the Q3 roadmap document?',
          labelIds: ['UNREAD', 'INBOX'],
          payload: {
            headers: [
              { name: 'Subject', value: 'Action Required: Q3 Roadmap' },
              { name: 'From', value: 'boss@company.com' },
              { name: 'Date', value: 'Mon, 1 May 2026 10:00:00 +0000' }
            ]
          }
        });
      }
      
      // Mock Notion API responses
      if (url.includes('api.notion.com/v1/users/me')) {
        return respond({ id: 'user1', name: 'Test Workspace', workspace_id: 'ws1' });
      }
      if (url.includes('api.notion.com/v1/search')) {
        return respond({
          results: [{
            object: 'page',
            id: 'page1',
            url: 'https://notion.so/page1',
            last_edited_time: '2026-05-01T12:00:00Z',
            properties: {
              title: { type: 'title', title: [{ plain_text: 'Product Sync Notes' }] }
            }
          }]
        });
      }
      if (url.includes('api.notion.com/v1/blocks/page1/children')) {
        return respond({
          results: [
            { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Here are the notes.' }] } },
            { type: 'to_do', to_do: { checked: false, rich_text: [{ plain_text: 'Update staging environment' }] } }
          ]
        });
      }

      // If not mocked, throw or return 404 to avoid real network requests
      console.warn('Unmocked URL called:', url);
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => JSON.stringify({ error: 'Not Found' }) };
    });

    // Create test user
    const res = await request(BASE)
      .post('/api/v1/auth/register')
      .send({
        email: `test-connector-${Date.now()}@flowra.test`,
        password: 'TestPassword123!',
        name: 'Connector Tester',
      })
      .expect(201);
    
    token = res.body.data.accessToken;
    userId = res.body.data.user.id;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (token) {
      await request(BASE)
        .delete('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    }
  });

  describe('Gmail Connector', () => {
    it('should connect to Gmail and save state', async () => {
      const res = await gmailAdapter.connect(db, userId, { accessToken: 'mock-google-token' });
      expect(res.success).toBe(true);
      expect(res.email).toBe('test@gmail.com');

      const status = await gmailAdapter.getStatus(db, userId);
      expect(status).toBe('connected');
    });

    it('should sync emails and parse metadata correctly', async () => {
      const items = await gmailAdapter.sync(db, userId);
      
      expect(items).toBeInstanceOf(Array);
      expect(items.length).toBe(1);
      
      const item = items[0];
      expect(item.type).toBe('email');
      expect(item.title).toBe('Action Required: Q3 Roadmap');
      expect(item.text).toContain('Can you please review the Q3 roadmap document?');
      expect(item.isRead).toBe(false);
      expect(item.metadata.from).toBe('boss@company.com');
    });

    it('should disconnect from Gmail cleanly', async () => {
      const res = await gmailAdapter.disconnect(db, userId);
      expect(res.success).toBe(true);

      const status = await gmailAdapter.getStatus(db, userId);
      expect(status).toBe('disconnected');
    });
  });

  describe('Notion Connector', () => {
    it('should connect to Notion and save state', async () => {
      const res = await notionAdapter.connect(db, userId, { accessToken: 'mock-notion-token' });
      expect(res.success).toBe(true);
      expect(res.workspace).toBe('Test Workspace');

      const status = await notionAdapter.getStatus(db, userId);
      expect(status).toBe('connected');
    });

    it('should sync Notion pages and parse blocks/todos correctly', async () => {
      // Connect again because state was cleared in previous disconnect
      await notionAdapter.connect(db, userId, { accessToken: 'mock-notion-token' });

      const items = await notionAdapter.sync(db, userId);
      
      expect(items).toBeInstanceOf(Array);
      expect(items.length).toBe(1);
      
      const item = items[0];
      expect(item.type).toBe('document');
      expect(item.title).toBe('Product Sync Notes');
      
      // Should extract paragraphs and to-do lists correctly
      expect(item.text).toContain('Here are the notes.');
      expect(item.text).toContain('[ ] Update staging environment');
    });

    it('should disconnect from Notion cleanly', async () => {
      const res = await notionAdapter.disconnect(db, userId);
      expect(res.success).toBe(true);

      const status = await notionAdapter.getStatus(db, userId);
      expect(status).toBe('disconnected');
    });
  });
});
