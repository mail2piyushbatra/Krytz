require('dotenv').config();
const logger = require('./lib/logger');
const db = require('./lib/db');
const { initializeEngines, engines } = require('./engines');

async function startWorker() {
  // Verify database connection
  await db.verifyConnection();
  logger.info('Worker: Database connected');

  // Initialize all engines (sets up DB repo, TSG, etc.)
  await initializeEngines();
  logger.info('Worker: All engines initialized');

  // Start the Bull queue processor
  logger.info('Worker: Starting Bull extraction worker...');
  engines.cortex.startWorker();
}

startWorker().catch(err => {
  logger.error('Worker failed to start', { error: err });
  process.exit(1);
});
