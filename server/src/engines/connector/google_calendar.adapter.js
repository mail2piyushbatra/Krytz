const { BaseAdapter, ConnectorState, saveConnectorState, getConnectorState } = require('./connector.framework');
const logger = require('../../lib/logger');

class GoogleCalendarAdapter extends BaseAdapter {
  constructor() {
    super('google_calendar', {
      displayName: 'Google Calendar',
      description: 'Sync upcoming events and extract action items from meeting notes.',
      icon: '📅',
      scopes: ['read']
    });
  }

  async connect(db, userId, credentials) {
    logger.info(`Connecting Google Calendar for user ${userId}`);
    // In a real implementation, we would exchange an auth code for refresh/access tokens
    // using the 'googleapis' package. For now, we simulate a successful connection.
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
    logger.info(`Disconnecting Google Calendar for user ${userId}`);
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
      throw new Error('Google Calendar is not connected');
    }

    logger.info(`Syncing Google Calendar for user ${userId}`);
    
    // Update state to syncing
    await saveConnectorState(db, userId, this.name, ConnectorState.SYNCING, state.meta);

    // Mock API call to Google Calendar API
    const today = new Date();
    const mockEvents = [
      {
        id: 'evt_1',
        type: 'event',
        title: 'Project Roadmap Review',
        text: 'Discuss Q3 deliverables and assign owners for the new mobile app features.',
        metadata: {
          startTime: new Date(today.setHours(14, 0, 0, 0)).toISOString(),
          endTime: new Date(today.setHours(15, 0, 0, 0)).toISOString(),
          attendees: ['raj@example.com', 'sarah@example.com'],
          isOrganizer: true,
          status: 'confirmed'
        }
      },
      {
        id: 'evt_2',
        type: 'event',
        title: '1:1 with Manager',
        text: 'Review performance goals and block out time for deep work.',
        metadata: {
          startTime: new Date(today.setHours(16, 30, 0, 0)).toISOString(),
          endTime: new Date(today.setHours(17, 0, 0, 0)).toISOString(),
          status: 'confirmed'
        }
      }
    ];

    // Restore state
    await saveConnectorState(db, userId, this.name, ConnectorState.CONNECTED, {
      ...state.meta,
      lastSyncAt: new Date().toISOString()
    });

    return mockEvents;
  }
}

module.exports = new GoogleCalendarAdapter();
