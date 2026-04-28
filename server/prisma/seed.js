const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://flowra:flowra_dev_password@localhost:5544/flowra?schema=public',
});

const firstNames = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Sam', 'Riley', 'Jamie', 'Morgan', 'Quinn', 'Avery'];
const domains = ['techcorp.io', 'startup.co', 'designstudio.net', 'freelance.app', 'venture.capital'];

const seedUsers = firstNames.map((name, index) => ({
  name,
  email: `${name.toLowerCase()}@${domains[index % domains.length]}`,
}));

const demoUser = {
  email: 'demo@flowra.app',
  name: 'Demo User',
  items: [
    { text: 'Fix Token Interceptor', state: 'OPEN', category: 'engineering', priority: 0.9, blocker: false },
    { text: 'Build Image Upload', state: 'OPEN', category: 'engineering', priority: 0.8, blocker: false },
    { text: 'Review Snooze PR', state: 'DONE', category: 'review', priority: 0.5, blocker: false },
  ],
};

function generateSyntheticData() {
  return {
    entries: [
      'Had a great sync with the design team today. We need to finalize the Q3 mockups by Friday, and I promised to review the copy.',
      'Just realized my passport expires in 2 months. I need to book an appointment to renew it ASAP.',
      "Client call went well, but they asked for an expedited timeline. I'm blocked on the backend API being ready.",
      'Feeling a bit burnt out. Going to take tomorrow morning off and go for a hike.',
      'Brainstorming for the new marketing site: we should use more dynamic animations and a darker theme.',
    ],
    items: [
      { text: 'Finalize Q3 mockups', state: 'OPEN', category: 'work', priority: 0.9, blocker: false },
      { text: 'Review design copy', state: 'OPEN', category: 'work', priority: 0.7, blocker: false },
      { text: 'Renew passport', state: 'IN_PROGRESS', category: 'personal', priority: 0.8, blocker: true },
      { text: 'Expedite client timeline', state: 'OPEN', category: 'work', priority: 0.9, blocker: true },
      { text: 'Take morning off for hike', state: 'DONE', category: 'health', priority: 0.5, blocker: false },
      { text: 'Draft marketing site animations', state: 'OPEN', category: 'design', priority: 0.6, blocker: false },
    ],
  };
}

async function main() {
  console.log('Seeding Flowra database with deterministic synthetic users...\n');

  const passwordHash = await bcrypt.hash('flowra123', 10);

  await pool.query('BEGIN');
  try {
    for (let i = 0; i < seedUsers.length; i += 1) {
      const { name, email } = seedUsers[i];
      const userId = await upsertSeedUser(email, name, passwordHash);
      await resetSeedUserRows(userId);
      await insertSeedEntriesAndItems(userId, generateSyntheticData());
      console.log(`Seeded user ${i + 1}/${seedUsers.length}: ${name} (${email}) - Password: flowra123`);
    }

    const demoUserId = await upsertSeedUser(demoUser.email, demoUser.name, passwordHash);
    await resetSeedUserRows(demoUserId);
    await insertItems(demoUserId, demoUser.items);
    await grantDemoFounder(demoUserId);

    await pool.query('COMMIT');
    console.log(`Seeded primary demo: ${demoUser.name} (${demoUser.email}) - Password: flowra123`);
    console.log('\nCold start complete. Database is primed.');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function upsertSeedUser(email, name, passwordHash) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, onboarded)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       onboarded = true,
       updated_at = now()
     RETURNING id`,
    [email, name, passwordHash]
  );

  return rows[0].id;
}

async function resetSeedUserRows(userId) {
  await pool.query('DELETE FROM entries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM items WHERE user_id = $1', [userId]);
}

async function insertSeedEntriesAndItems(userId, data) {
  for (const entryText of data.entries) {
    await pool.query(
      `INSERT INTO entries (user_id, raw_text, source)
       VALUES ($1, $2, 'manual')`,
      [userId, entryText]
    );
  }

  await insertItems(userId, data.items);
}

async function insertItems(userId, items) {
  for (const item of items) {
    await pool.query(
      `INSERT INTO items (user_id, canonical_text, state, category, priority, blocker)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, item.text, item.state, item.category, item.priority, item.blocker]
    );
  }
}

async function grantDemoFounder(userId) {
  const { rows: [org] } = await pool.query(
    `INSERT INTO organizations(name, slug)
     VALUES('Flowra Local Ops', 'flowra-local-ops')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  await pool.query(
    `INSERT INTO organization_members(org_id, user_id, role)
     VALUES($1, $2, 'founder')
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [org.id, userId]
  );
}

main()
  .catch(error => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
