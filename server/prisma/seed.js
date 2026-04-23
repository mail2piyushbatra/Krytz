const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('✦ Seeding Flowra database...\n');

  // Create demo user
  const passwordHash = await bcrypt.hash('flowra123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'demo@flowra.app' },
    update: {},
    create: {
      email: 'demo@flowra.app',
      passwordHash,
      name: 'Demo User',
      settings: { theme: 'dark' },
    },
  });

  console.log(`✦ Created user: ${user.email} (password: flowra123)`);

  // Create sample entries
  const sampleEntries = [
    {
      rawText: 'Had a productive morning. Finished the auth module and wrote tests for login/register flows.',
      source: 'manual',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
    },
    {
      rawText: 'Call with Rajesh about API pricing. He wants a proposal by Friday. Need to crunch numbers tonight.',
      source: 'manual',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
    {
      rawText: 'Blocked on the file upload feature. S3 presigned URLs keep expiring too fast. Need to check the config.',
      source: 'manual',
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
    },
    {
      rawText: 'Merged 3 PRs. Code review done for the state aggregation service.',
      source: 'manual',
      timestamp: new Date(), // now
    },
  ];

  for (const entry of sampleEntries) {
    const created = await prisma.entry.create({
      data: {
        userId: user.id,
        ...entry,
      },
    });

    console.log(`✦ Created entry: "${entry.rawText.slice(0, 50)}..."`);
  }

  // Create sample extracted states (normally done by AI)
  const entries = await prisma.entry.findMany({
    where: { userId: user.id },
    orderBy: { timestamp: 'asc' },
  });

  const sampleStates = [
    {
      actionItems: [],
      blockers: [],
      completions: [
        { text: 'Finished auth module' },
        { text: 'Wrote login/register tests' },
      ],
      deadlines: [],
      tags: ['auth', 'testing'],
      sentiment: 'productive',
    },
    {
      actionItems: [
        { text: 'Send API pricing proposal to Rajesh', dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
        { text: 'Crunch pricing numbers tonight' },
      ],
      blockers: [],
      completions: [],
      deadlines: [
        { task: 'API pricing proposal', date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
      ],
      tags: ['meeting', 'rajesh', 'api'],
      sentiment: 'focused',
    },
    {
      actionItems: [{ text: 'Check S3 presigned URL config' }],
      blockers: [{ text: 'S3 presigned URLs expiring too fast' }],
      completions: [],
      deadlines: [],
      tags: ['file-upload', 's3', 'blocker'],
      sentiment: 'stressed',
    },
    {
      actionItems: [],
      blockers: [],
      completions: [
        { text: 'Merged 3 PRs' },
        { text: 'Code review for state aggregation' },
      ],
      deadlines: [],
      tags: ['code-review', 'prs'],
      sentiment: 'productive',
    },
  ];

  for (let i = 0; i < entries.length; i++) {
    await prisma.extractedState.create({
      data: {
        entryId: entries[i].id,
        ...sampleStates[i],
      },
    });
  }

  console.log(`\n✦ Created ${sampleStates.length} extracted states`);

  // Create daily state
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.dailyState.upsert({
    where: { userId_date: { userId: user.id, date: today } },
    update: {},
    create: {
      userId: user.id,
      date: today,
      openItems: 3,
      blockerCount: 1,
      completedCount: 4,
      deadlines: sampleStates[1].deadlines,
      summary: 'Productive day — 4 items completed, 1 blocker on S3 config, API proposal due Friday.',
    },
  });

  console.log('✦ Created daily state\n');
  console.log('✦ Seeding complete!\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
