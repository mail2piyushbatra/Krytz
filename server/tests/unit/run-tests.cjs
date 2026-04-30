const assert = require('node:assert/strict');

const { CommandStatus, CommandType, executeCommand } = require('../../src/engines/execution/execution.engine');

async function run() {
  await testExecutionNotification();
  testExternalCommandTypes();
  console.log('server unit tests passed');
}

function createFakeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM notifications')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
  };
}

async function testExecutionNotification() {
  const db = createFakeDb();
  const result = await executeCommand(db, '00000000-0000-0000-0000-000000000001', {
    type: CommandType.NOTIFY_USER,
    payload: {
      title: 'Test notification',
      body: 'Unit test command',
      meta: { dedupe: 'unit-test' },
    },
    source: 'unit-test',
  });

  assert.equal(result.status, CommandStatus.COMPLETED);
  assert.equal(result.events[0].type, 'NOTIFICATION_CREATED');
  assert.equal(db.calls.some(call => call.sql.includes('INSERT INTO command_log')), true);
}

function testExternalCommandTypes() {
  assert.equal(CommandType.CREATE_CALENDAR_EVENT, 'CREATE_CALENDAR_EVENT');
  assert.equal(CommandType.CALL_HTTP_API, 'CALL_HTTP_API');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
