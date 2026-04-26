/**
 * ✦ USAGE TIERS + FEATURE FLAGS
 * Three tiers: free (50 items, no AI) | pro ($9/mo, unlimited, full AI) | team ($25/seat, shared graphs)
 * Feature gates checked at middleware — not scattered across routes.
 * Stripe webhook handler included.
 */
'use strict';

const TIERS = {
  free: {
    name: 'free', maxItems: 50, maxRules: 3, maxDailyCaptures: 20,
    aiRecall: false, semanticSearch: false, connectors: false, sharedGraphs: false,
    weeklyPlanner: false, whatIfSimulator: false, contradictionDetector: false, timeEstimation: false,
  },
  pro: {
    name: 'pro', maxItems: null, maxRules: 50, maxDailyCaptures: null,
    aiRecall: true, semanticSearch: true, connectors: true, sharedGraphs: false,
    weeklyPlanner: true, whatIfSimulator: true, contradictionDetector: true, timeEstimation: true,
  },
  team: {
    name: 'team', maxItems: null, maxRules: 200, maxDailyCaptures: null,
    aiRecall: true, semanticSearch: true, connectors: true, sharedGraphs: true,
    weeklyPlanner: true, whatIfSimulator: true, contradictionDetector: true, timeEstimation: true,
  },
};

async function getUserTier(db, userId) {
  const { rows } = await db.query(`SELECT subscription_tier, trial_ends_at FROM users WHERE id=$1`, [userId]).catch(() => ({ rows: [] }));
  if (rows.length === 0) return TIERS.free;
  const tier = rows[0].subscription_tier || 'free';
  if (tier === 'free' && rows[0].trial_ends_at && new Date(rows[0].trial_ends_at) > new Date()) return { ...TIERS.pro, name: 'trial' };
  return TIERS[tier] || TIERS.free;
}

// router.get('/recall', requireFeature('aiRecall'), handler)
function requireFeature(featureName) {
  return async (req, res, next) => {
    const tier = req.userTier || await getUserTier(req.db, req.user.id);
    if (!tier[featureName]) {
      return res.status(403).json({ error: 'Feature not available on your plan', feature: featureName, upgrade: _upgradeMessage(featureName), currentTier: tier.name });
    }
    next();
  };
}

// app.use('/api', authMiddleware, tierMiddleware(pool), rlsMiddleware(pool))
function tierMiddleware(pool) {
  return async (req, res, next) => {
    if (!req.user?.id) return next();
    const db = req.db || pool;
    req.userTier = await getUserTier(db, req.user.id);
    next();
  };
}

async function checkItemLimit(db, userId) {
  const tier = await getUserTier(db, userId);
  if (!tier.maxItems) return { allowed: true };
  const { rows } = await db.query(`SELECT count(*) AS n FROM items WHERE user_id=$1 AND state NOT IN ('DONE','DROPPED')`, [userId]);
  const current = parseInt(rows[0].n);
  return { allowed: current < tier.maxItems, current, max: tier.maxItems, message: current >= tier.maxItems ? `You've reached the ${tier.maxItems} item limit on the free plan. Upgrade to Pro for unlimited items.` : null };
}

async function checkDailyCapture(db, userId) {
  const tier = await getUserTier(db, userId);
  if (!tier.maxDailyCaptures) return { allowed: true };
  const { rows } = await db.query(`SELECT count(*) AS n FROM entries WHERE user_id=$1 AND timestamp::date=CURRENT_DATE`, [userId]);
  const current = parseInt(rows[0].n);
  return { allowed: current < tier.maxDailyCaptures, current, max: tier.maxDailyCaptures };
}

async function handleStripeWebhook(db, rawBody, signature) {
  let stripe, event;
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event  = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) { throw Object.assign(new Error(`Stripe webhook error: ${err.message}`), { status: 400 }); }

  const data = event.data.object;
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const tier = _stripeProductToTier(data.items?.data?.[0]?.price?.lookup_key);
      await db.query(`UPDATE users SET subscription_tier=$1, stripe_customer_id=$2 WHERE stripe_customer_id=$2 OR id=(SELECT user_id FROM stripe_customers WHERE customer_id=$2 LIMIT 1)`, [tier, data.customer]).catch(() => {});
      break;
    }
    case 'customer.subscription.deleted':
      await db.query(`UPDATE users SET subscription_tier='free' WHERE stripe_customer_id=$1`, [data.customer]).catch(() => {});
      break;
    case 'checkout.session.completed': {
      const userId = data.metadata?.user_id;
      if (userId) await db.query(`UPDATE users SET stripe_customer_id=$1 WHERE id=$2`, [data.customer, userId]).catch(() => {});
      break;
    }
  }
  return { received: true, type: event.type };
}

async function createCheckoutSession(userId, priceId, successUrl, cancelUrl) {
  const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], success_url: successUrl, cancel_url: cancelUrl, metadata: { user_id: userId }, allow_promotion_codes: true });
  return { url: session.url, sessionId: session.id };
}

function _stripeProductToTier(lookupKey) {
  if (!lookupKey) return 'free';
  if (lookupKey.includes('pro'))  return 'pro';
  if (lookupKey.includes('team')) return 'team';
  return 'free';
}

function _upgradeMessage(feature) {
  return ({ aiRecall: 'AI recall is available on the Pro plan.', semanticSearch: 'Semantic search is available on the Pro plan.', connectors: 'Integrations are available on the Pro plan.', weeklyPlanner: 'Weekly planning is available on the Pro plan.', whatIfSimulator: 'What-if simulation is available on the Pro plan.', contradictionDetector: 'Conflict detection is available on the Pro plan.', timeEstimation: 'Time estimation is available on the Pro plan.', sharedGraphs: 'Shared workspaces are available on the Team plan.' })[feature] || 'Upgrade to Pro to unlock this feature.';
}

module.exports = { TIERS, getUserTier, requireFeature, tierMiddleware, checkItemLimit, checkDailyCapture, handleStripeWebhook, createCheckoutSession };
