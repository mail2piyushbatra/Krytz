const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const TARGET_EMAIL = process.env.NEW_USER_EMAIL || 'mail2piyushbatra@gmail.com';
const TARGET_PASSWORD = process.env.NEW_USER_PASSWORD || 'Abc@123';
const TARGET_NAME = process.env.NEW_USER_NAME || 'Piyush';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const passwordHash = await bcrypt.hash(TARGET_PASSWORD, 12);

  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, onboarded)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       updated_at = now()
     RETURNING id, email, name, created_at`,
    [TARGET_EMAIL, TARGET_NAME, passwordHash]
  );

  const user = rows[0];

  const { rows: [orgRow] } = await pool.query(
    `INSERT INTO organizations(name, slug)
     VALUES('Krytz Local Ops', 'krytz-local-ops')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  await pool.query(
    `INSERT INTO organization_members(org_id, user_id, role)
     VALUES($1, $2, 'founder')
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [orgRow.id, user.id]
  );

  console.log(`User upserted: ${user.email} (id=${user.id})`);
}

main()
  .catch((err) => {
    console.error('create-user failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
