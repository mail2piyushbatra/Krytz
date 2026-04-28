const { BaseAdapter, ConnectorState, saveConnectorState, getConnectorState } = require('./connector.framework');
const logger = require('../../lib/logger');

class GmailAdapter extends BaseAdapter {
  constructor() {
    super('gmail', {
      displayName: 'Gmail',
      description: 'Find actionable items and important requests buried in your inbox.',
      icon: '📧',
      scopes: ['read']
    });
  }

  async connect(db, userId, credentials) {
    logger.info(`Connecting Gmail for user ${userId}`);
    const meta = {
      accessToken: credentials?.accessToken || 'mock_access_token',
      refreshToken: credentials?.refreshToken || 'mock_refresh_token',
      expiresAt: Date.now() + 3600 * 1000,
      email: credentials?.email || 'user@example.com'
    };
    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, meta);
    return { success: true };
  }

  async disconnect(db, userId) {
    logger.info(`Disconnecting Gmail for user ${userId}`);
    await saveConnectorState(db, userId, this.name, ConnectorState.DISCONNECTED, {});
    return { success: true };
  }

  async getStatus(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    return state.state;
  }

  async sync(db, userId) {
    const state = await getConnectorState(db, userId, this.name);
    if (state.state !== ConnectorState.CONNECTED) {
      throw new Error('Gmail is not connected');
    }

    logger.info(`Syncing Gmail for user ${userId}`);
    await saveConnectorState(db, userId, this.name, ConnectorState.SYNCING, state.meta);

    // Mock API call to Gmail API (e.g., querying for "is:unread category:primary")
    const mockEmails = [
      {
        id: 'msg_1',
        type: 'email',
        title: 'Action Required: Update your billing details',
        text: 'Your corporate card is expiring soon. Please log into the portal and update your payment method by Friday.',
        isRead: false,
        requiresAction: true,
        metadata: {
          from: 'billing@company.com',
          date: new Date().toISOString(),
          labels: ['UNREAD', 'INBOX']
        }
      },
      {
        id: 'msg_2',
        type: 'email',
        title: 'Draft proposal for Q4',
        text: 'Hey, I attached the draft. Can you review it and leave comments before our sync tomorrow?',
        isRead: false,
        requiresAction: true,
        metadata: {
          from: 'teammate@company.com',
          date: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
          labels: ['UNREAD', 'INBOX']
        }
      }
    ];

    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
      ...state.meta,
      lastSyncAt: new Date().toISOString()
    });

    return mockEmails;
  }
}

module.exports = new GmailAdapter();
