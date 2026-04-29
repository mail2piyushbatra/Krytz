const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MIGRATION_FILES = [
  'schema.foundation.sql',
  'refresh_tokens.v3.sql',
  'schema.v3.sql',
  'schema.categories.sql',
  'schema.missing.sql',
  'schema.phases.sql',
  'platform.schema.sql',
];

async function runBootMigrations(db) {
  if (process.env.Krytz_SKIP_BOOT_MIGRATIONS === 'true') {
    logger.info('Boot migrations skipped by Krytz_SKIP_BOOT_MIGRATIONS');
    return;
  }

  const prismaDir = path.resolve(__dirname, '../../prisma');
  for (const file of MIGRATION_FILES) {
    const filePath = path.join(prismaDir, file);
    if (!fs.existsSync(filePath)) {
      logger.warn('Boot migration file missing', { file });
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf8').trim();
    if (!sql) continue;
    await db.query(sql);
    logger.info('Boot migration applied', { file });
  }
}

module.exports = { runBootMigrations };
