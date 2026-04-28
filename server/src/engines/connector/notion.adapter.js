const { BaseAdapter, ConnectorState, saveConnectorState, getConnectorState } = require('./connector.framework');
const logger = require('../../lib/logger');

class NotionAdapter extends BaseAdapter {
  constructor() {
    super('notion', {
      displayName: 'Notion',
      description: 'Extract action items from your meeting notes and project specs.',
      icon: '📓',
      scopes: ['read']
    });
  }

  async connect(db, userId, credentials) {
    logger.info(`Connecting Notion for user ${userId}`);
    const meta = {
      accessToken: credentials?.accessToken || 'mock_notion_token',
      workspaceId: credentials?.workspaceId || 'mock_workspace_id',
      botId: credentials?.botId || 'mock_bot_id'
    };
    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, meta);
    return { success: true };
  }

  async disconnect(db, userId) {
    logger.info(`Disconnecting Notion for user ${userId}`);
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
      throw new Error('Notion is not connected');
    }

    logger.info(`Syncing Notion for user ${userId}`);
    await saveConnectorState(db, userId, this.name, ConnectorState.SYNCING, state.meta);

    // Mock API call to Notion (e.g., querying for recent pages with uncompleted to-do blocks)
    const mockPages = [
      {
        id: 'page_1',
        type: 'document',
        title: 'Weekly Team Sync',
        text: 'Action items:\n- [ ] Follow up with design on new assets\n- [ ] Update the API documentation before release\n- [x] Send weekly update email',
        metadata: {
          url: 'https://notion.so/Weekly-Team-Sync-123456',
          lastEditedTime: new Date().toISOString()
        }
      }
    ];

    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
      ...state.meta,
      lastSyncAt: new Date().toISOString()
    });

    return mockPages;
  }
}

module.exports = new NotionAdapter();
