/**
 * âœ¦ RULE DSL â€” SCHEMA + NL COMPILER + LINTER
 *
 * Three concerns in one file:
 *   1. Schema: validates rule JSON (Zod-equivalent in pure JS)
 *   2. Compiler: NL â†’ DSL via LLM (constrained, function-calling)
 *   3. Linter: safety + cost guards before a rule is saved
 */

'use strict';

const OpenAI = require('openai');

// â”€â”€â”€ Available DSL variables (resolver-backed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VARIABLES = [
  'item.state', 'item.persistence_days', 'item.priority',
  'item.blocker', 'item.deadline_days', 'item.project',
  'item.downstream_open', 'item.blocked_by_prereq',
  'memory.recurrence_7d',
  'time.hour', 'time.day_of_week',
  'user.streak_days',
];

const ACTIONS = ['NOTIFY', 'SET_STATE', 'ADD_TAG', 'WEBHOOK'];
const STATES  = ['IN_PROGRESS', 'DONE', 'DROPPED'];
const OPS     = ['AND', 'OR', 'GT', 'GTE', 'LT', 'LTE', 'EQ', 'EXISTS', 'MATCH'];

// â”€â”€â”€ Schema validator (pure JS â€” no Zod dependency) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function validateExpr(node) {
  if (!node || typeof node !== 'object') throw new Error('Expr must be an object');
  if ('const' in node) {
    const t = typeof node.const;
    if (!['string','number','boolean'].includes(t)) throw new Error(`const must be string/number/boolean, got ${t}`);
    return;
  }
  if ('var' in node) {
    if (!VARIABLES.includes(node.var)) throw new Error(`Unknown variable: ${node.var}. Allowed: ${VARIABLES.join(', ')}`);
    return;
  }
  throw new Error('Expr must have "var" or "const"');
}

function validateCondition(node, depth = 0) {
  if (depth > 10) throw new Error('Condition too deeply nested');
  if (!node || typeof node !== 'object') throw new Error('Condition must be an object');

  if (!OPS.includes(node.op)) throw new Error(`Unknown op: ${node.op}. Allowed: ${OPS.join(', ')}`);

  if (node.op === 'AND' || node.op === 'OR') {
    if (!Array.isArray(node.args) || node.args.length < 1) throw new Error(`${node.op} requires args array`);
    node.args.forEach(a => validateCondition(a, depth + 1));
    return;
  }
  if (node.op === 'EXISTS') {
    if (!VARIABLES.includes(node.path)) throw new Error(`EXISTS: unknown path ${node.path}`);
    return;
  }
  if (node.op === 'MATCH') {
    if (!VARIABLES.includes(node.path)) throw new Error(`MATCH: unknown path ${node.path}`);
    if (typeof node.regex !== 'string') throw new Error('MATCH: regex must be string');
    try { new RegExp(node.regex); } catch (_) { throw new Error(`MATCH: invalid regex ${node.regex}`); }
    return;
  }
  // GT / GTE / LT / LTE / EQ
  validateExpr(node.left);
  validateExpr(node.right);
}

function validateAction(node) {
  if (!node || typeof node !== 'object') throw new Error('Action must be an object');
  if (!ACTIONS.includes(node.type)) throw new Error(`Unknown action type: ${node.type}`);

  if (node.type === 'NOTIFY') {
    if (typeof node.title !== 'string' || !node.title.trim()) throw new Error('NOTIFY: title required');
    if (typeof node.body  !== 'string' || !node.body.trim())  throw new Error('NOTIFY: body required');
  }
  if (node.type === 'SET_STATE') {
    if (!STATES.includes(node.state)) throw new Error(`SET_STATE: invalid state ${node.state}`);
  }
  if (node.type === 'ADD_TAG') {
    if (typeof node.tag !== 'string' || !node.tag.trim()) throw new Error('ADD_TAG: tag required');
  }
  if (node.type === 'WEBHOOK') {
    if (typeof node.url !== 'string') throw new Error('WEBHOOK: url required');
    try { new URL(node.url); } catch (_) { /* allow internal:// */ }
  }
}

function validateRule(rule) {
  const errors = [];
  try {
    if (!rule.name || typeof rule.name !== 'string') errors.push('name required');
    validateCondition(rule.condition);
    validateAction(rule.action);
    if (rule.cooldown_seconds !== null && rule.cooldown_seconds !== undefined && (typeof rule.cooldown_seconds !== 'number' || rule.cooldown_seconds < 0)) {
      errors.push('cooldown_seconds must be non-negative number');
    }
  } catch (e) {
    errors.push(e.message);
  }
  return errors;
}

// â”€â”€â”€ Policy linter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function lintRule(rule) {
  const warnings = [];

  // Anti-spam: NOTIFY with no cooldown
  if (rule.action.type === 'NOTIFY' && (rule.cooldown_seconds ?? 0) < 3600) {
    warnings.push('NOTIFY with cooldown < 1h may produce spam. Recommended: cooldown_seconds >= 86400');
  }

  // No state guard â€” rule fires on ALL items every sweep
  const condStr = JSON.stringify(rule.condition);
  if (!condStr.includes('item.state')) {
    warnings.push('No item.state guard â€” rule will evaluate on every item. Add state filter.');
  }

  // Regex complexity
  const regexMatches = condStr.match(/"regex"\s*:\s*"[^"]+"/g) || [];
  for (const m of regexMatches) {
    if (m.length > 100) warnings.push('Complex regex pattern detected â€” may be slow at scale');
  }

  // Oversized condition
  if (condStr.length > 3000) warnings.push('Condition JSON > 3000 chars â€” consider simplifying');

  // Webhook safety
  if (rule.action.type === 'WEBHOOK') {
    if (!(rule.action.url || '').startsWith('internal://') && (rule.cooldown_seconds ?? 0) < 60) {
      warnings.push('External WEBHOOK with cooldown < 60s may cause rate-limit issues');
    }
  }

  return warnings;
}

// â”€â”€â”€ NL â†’ DSL compiler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const COMPILER_SYSTEM = `You are a rule DSL compiler for Krytz, a task tracking system.
Convert the user's natural language description into a STRICT JSON rule object.

ONLY use these exact fields and values â€” nothing else:

Operators: ${OPS.join(', ')}
Variables: ${VARIABLES.join(', ')}
Action types: ${ACTIONS.join(', ')}
States for SET_STATE: ${STATES.join(', ')}

Output schema (JSON only, no markdown):
{
  "name": string,
  "condition": Condition,
  "action": Action,
  "cooldown_seconds": integer (0 if not mentioned),
  "priority": integer (0 default)
}

Where Condition is:
  { "op": "AND"|"OR", "args": [Condition...] }
  | { "op": "GT"|"GTE"|"LT"|"LTE"|"EQ", "left": Expr, "right": Expr }
  | { "op": "EXISTS", "path": variable }
  | { "op": "MATCH", "path": variable, "regex": string }

And Expr is:
  { "var": variable } | { "const": string|number|boolean }

Rules:
- Always add a cooldown when action is NOTIFY (default 86400)
- Always add item.state guard when possible
- Keep conditions simple â€” max 3 AND levels
- Use {{item.text}} template in NOTIFY body when referencing the item
- Return ONLY the JSON object â€” no explanation, no markdown code fences`;

async function compileRule(nl) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const resp = await client.chat.completions.create({
    model:           'gpt-4o-mini',
    temperature:     0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: COMPILER_SYSTEM },
      { role: 'user',   content: nl },
    ],
  });

  const raw = resp.choices[0].message.content;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`Compiler returned invalid JSON: ${raw.slice(0, 200)}`); }

  // Validate
  const errors = validateRule(parsed);
  if (errors.length > 0) {
    throw new Error(`Compiled rule failed validation: ${errors.join('; ')}\n\nOutput was: ${JSON.stringify(parsed, null, 2)}`);
  }

  const warnings = lintRule(parsed);

  return { rule: parsed, warnings };
}

module.exports = { validateRule, lintRule, compileRule, VARIABLES, ACTIONS, OPS };
