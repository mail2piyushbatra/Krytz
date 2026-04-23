const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../../lib/prisma');
const { AppError } = require('../../middleware/errorHandler');

const SALT_ROUNDS = 12;

/**
 * Register a new user.
 */
async function register({ email, password, name }) {
  // Check if user exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError('Email already registered.', 409, 'CONFLICT');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Create user
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  // Generate tokens
  const tokens = await generateTokens(user);

  return { user, ...tokens };
}

/**
 * Login with email and password.
 */
async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('Invalid email or password.', 401, 'UNAUTHORIZED');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AppError('Invalid email or password.', 401, 'UNAUTHORIZED');
  }

  const tokens = await generateTokens(user);

  return {
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    ...tokens,
  };
}

/**
 * Refresh access token using a valid refresh token.
 */
async function refresh(refreshToken) {
  // Find refresh token in DB
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date()) {
    // Clean up expired token if found
    if (stored) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
    }
    throw new AppError('Invalid or expired refresh token.', 401, 'UNAUTHORIZED');
  }

  // Rotate: delete old token, create new pair
  await prisma.refreshToken.delete({ where: { id: stored.id } });

  const tokens = await generateTokens(stored.user);

  return {
    user: {
      id: stored.user.id,
      email: stored.user.email,
      name: stored.user.name,
      createdAt: stored.user.createdAt,
    },
    ...tokens,
  };
}

/**
 * Get current user profile.
 */
async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, settings: true, createdAt: true },
  });
  if (!user) throw new AppError('User not found.', 404, 'NOT_FOUND');
  return user;
}

/**
 * Delete user account and all data.
 * Purges all files from S3/R2 before cascading DB deletes.
 */
async function deleteAccount(userId) {
  // 1. Collect all file keys before deleting DB records
  const files = await prisma.fileAttachment.findMany({
    where: { entry: { userId } },
    select: { fileKey: true },
  });

  // 2. Delete files from S3/R2
  if (files.length > 0) {
    const { deleteFilesFromS3 } = require('../files/file.service');
    await deleteFilesFromS3(files.map((f) => f.fileKey));
  }

  // 3. Cascade delete all DB records (entries, states, files, tokens)
  await prisma.user.delete({ where: { id: userId } });

  return { message: 'Account and all data deleted.' };
}

// ─── Helpers ──────────────────────────────────────────────────────

async function generateTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');

  // Store refresh token in DB
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  return { accessToken, refreshToken };
}

module.exports = { register, login, refresh, getProfile, deleteAccount };
