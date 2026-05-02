/**
 * ✦ Krytz — Categories Service
 *
 * User-defined static buckets (Infra, Product, Hiring, Fundraise, etc.)
 * with item counts per state. Categories give structure to the CEO's mental model.
 */

const db = require('../../lib/db');
const logger = require('../../lib/logger');
const { AppError } = require('../../middleware/errorHandler');

// ─── Row mapper ───────────────────────────────────────────────────────────────

function toApiCategory(row) {
  return {
    id:        row.id,
    name:      row.name,
    color:     row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Item counts (if joined)
    itemCounts: row.open !== undefined ? {
      open:       parseInt(row.open) || 0,
      inProgress: parseInt(row.in_progress) || 0,
      blocked:    parseInt(row.blocked_count) || 0,
      done:       parseInt(row.done) || 0,
    } : undefined,
  };
}

// ─── List categories with item counts ─────────────────────────────────────────

async function listCategories(userId) {
  // Get user-defined categories with item counts
  const { rows } = await db.query(
    `SELECT c.*,
            COALESCE(SUM(CASE WHEN i.state = 'OPEN' THEN 1 ELSE 0 END), 0) AS open,
            COALESCE(SUM(CASE WHEN i.state = 'IN_PROGRESS' THEN 1 ELSE 0 END), 0) AS in_progress,
            COALESCE(SUM(CASE WHEN i.blocker = true AND i.state IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END), 0) AS blocked_count,
            COALESCE(SUM(CASE WHEN i.state = 'DONE' THEN 1 ELSE 0 END), 0) AS done
     FROM categories c
     LEFT JOIN items i ON i.user_id = c.user_id AND i.category = c.name
     WHERE c.user_id = $1
     GROUP BY c.id
     ORDER BY c.sort_order, c.name`,
    [userId]
  );

  // Also get count for "uncategorized" items
  const { rows: uncatRows } = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN state = 'OPEN' THEN 1 ELSE 0 END), 0) AS open,
       COALESCE(SUM(CASE WHEN state = 'IN_PROGRESS' THEN 1 ELSE 0 END), 0) AS in_progress,
       COALESCE(SUM(CASE WHEN blocker = true AND state IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END), 0) AS blocked_count,
       COALESCE(SUM(CASE WHEN state = 'DONE' THEN 1 ELSE 0 END), 0) AS done
     FROM items
     WHERE user_id = $1 AND (category = 'uncategorized' OR category IS NULL OR category NOT IN (
       SELECT name FROM categories WHERE user_id = $1
     ))`,
    [userId]
  );

  const categories = rows.map(toApiCategory);

  // Append uncategorized if it has items
  const uncat = uncatRows[0];
  const uncatTotal = (parseInt(uncat.open) || 0) + (parseInt(uncat.in_progress) || 0);
  if (uncatTotal > 0) {
    categories.push({
      id:        null,
      name:      'uncategorized',
      color:     '#8888a0',
      sortOrder: 999,
      createdAt: null,
      updatedAt: null,
      itemCounts: {
        open:       parseInt(uncat.open) || 0,
        inProgress: parseInt(uncat.in_progress) || 0,
        blocked:    parseInt(uncat.blocked_count) || 0,
        done:       parseInt(uncat.done) || 0,
      },
    });
  }

  return categories;
}

// ─── Create category ──────────────────────────────────────────────────────────

async function createCategory(userId, { name, color, sortOrder }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO categories (user_id, name, color, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, name.toLowerCase().trim(), color || '#6c5ce7', sortOrder || 0]
    );
    logger.info('Category created', { userId, name: rows[0].name });
    return toApiCategory(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(`Category "${name}" already exists`, 409);
    }
    throw err;
  }
}

// ─── Update category ──────────────────────────────────────────────────────────

async function updateCategory(userId, categoryId, updates) {
  const sets = [];
  const params = [];
  let idx = 1;

  if (updates.name !== undefined) {
    const newName = updates.name.toLowerCase().trim();
    sets.push(`name = $${idx}`); params.push(newName); idx++;
  }
  if (updates.color !== undefined) {
    sets.push(`color = $${idx}`); params.push(updates.color); idx++;
  }
  if (updates.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`); params.push(updates.sortOrder); idx++;
  }

  if (sets.length === 0) throw new AppError('No fields to update', 400);
  sets.push('updated_at = now()');

  params.push(categoryId, userId);

  // Get old name first (needed to update items)
  const { rows: oldRows } = await db.query(
    `SELECT name FROM categories WHERE id = $1 AND user_id = $2`,
    [categoryId, userId]
  );
  if (oldRows.length === 0) throw new AppError('Category not found', 404);
  const oldName = oldRows[0].name;

  const { rows } = await db.query(
    `UPDATE categories SET ${sets.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    params
  );

  // If name changed, update all items with the old category name
  if (updates.name && updates.name.toLowerCase().trim() !== oldName) {
    const newName = updates.name.toLowerCase().trim();
    await db.query(
      `UPDATE items SET category = $1, updated_at = now() WHERE user_id = $2 AND category = $3`,
      [newName, userId, oldName]
    );
    logger.info('Items recategorized', { userId, from: oldName, to: newName });
  }

  return toApiCategory(rows[0]);
}

// ─── Delete category ──────────────────────────────────────────────────────────

async function deleteCategory(userId, categoryId) {
  const { rows } = await db.query(
    `DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING name`,
    [categoryId, userId]
  );
  if (rows.length === 0) throw new AppError('Category not found', 404);

  // Move items to uncategorized
  const { rowCount } = await db.query(
    `UPDATE items SET category = 'uncategorized', updated_at = now()
     WHERE user_id = $1 AND category = $2`,
    [userId, rows[0].name]
  );

  logger.info('Category deleted', { userId, name: rows[0].name, itemsMoved: rowCount });
  return { message: `Category "${rows[0].name}" deleted. ${rowCount} items moved to uncategorized.` };
}

// ─── Seed default categories for new users ───────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: 'work',      color: '#4B7BD4', sortOrder: 1 },
  { name: 'personal',  color: '#D49B4B', sortOrder: 2 },
  { name: 'health',    color: '#4B9B6B', sortOrder: 3 },
  { name: 'errands',   color: '#9B6BD4', sortOrder: 4 },
  { name: 'learning',  color: '#C8A45A', sortOrder: 5 },
];

async function seedDefaults(userId) {
  // Check if user already has categories
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM categories WHERE user_id = $1`,
    [userId]
  );
  if (rows[0].count > 0) return false;

  for (const cat of DEFAULT_CATEGORIES) {
    await db.query(
      `INSERT INTO categories (user_id, name, color, sort_order)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userId, cat.name, cat.color, cat.sortOrder]
    );
  }
  logger.info('Default categories seeded', { userId, count: DEFAULT_CATEGORIES.length });
  return true;
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory, seedDefaults };
