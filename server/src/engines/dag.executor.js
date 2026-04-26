/**
 * ✦ DAG EXECUTOR
 *
 * Dependency-aware task graph execution engine.
 * Replaces linear: normalize → extract → store → state
 * With:           parallel-safe DAG with per-node retry + partial failure isolation.
 *
 * Key properties:
 *   - Nodes execute as soon as their deps complete (not sequentially)
 *   - Each node has its own retry budget
 *   - A node failure does NOT kill unrelated branches (isolation)
 *   - Shared context object flows between nodes
 *   - Full execution trace recorded for observability
 */

'use strict';

// ─── Types ────────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} DAGNode
 * @property {string}   id        - Unique node id
 * @property {string[]} deps      - ids that must complete before this runs
 * @property {Function} run       - async (ctx) => void — mutates shared ctx
 * @property {number}   [retry]   - max retries (default 0)
 * @property {number}   [backoff] - base delay ms for exponential backoff (default 200)
 * @property {boolean}  [critical]- if false, failure is non-fatal (default true)
 */

const STATES = { PENDING: 'PENDING', RUNNING: 'RUNNING', DONE: 'DONE', FAILED: 'FAILED' };

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class DAGExecutor {
  /**
   * Execute a graph of tasks with dependency resolution.
   *
   * @param {DAGNode[]} nodes   - Task definitions
   * @param {Object}    ctx     - Shared mutable context passed to every run()
   * @param {Object}    opts
   * @param {number}    opts.timeoutMs  - Total graph execution timeout (default 30s)
   * @returns {{ trace: Object[], partialFailures: string[] }}
   */
  async execute(nodes, ctx = {}, { timeoutMs = 30_000 } = {}) {
    const nodeMap    = new Map(nodes.map(n => [n.id, n]));
    const nodeState  = new Map(nodes.map(n => [n.id, STATES.PENDING]));
    const trace      = [];
    const partialFailures = [];

    this._validateGraph(nodes, nodeMap);

    const deadline = Date.now() + timeoutMs;

    // Keep ticking until all nodes terminal
    while (true) {
      const pending = nodes.filter(n => nodeState.get(n.id) === STATES.PENDING);
      if (pending.length === 0) break;

      if (Date.now() > deadline) {
        const stuck = pending.map(n => n.id);
        throw new Error(`DAG timeout. Stuck nodes: ${stuck.join(', ')}`);
      }

      // Find nodes whose deps are all DONE
      const ready = pending.filter(n =>
        n.deps.every(dep => nodeState.get(dep) === STATES.DONE)
      );

      // Check for deadlock: nodes pending but none ready
      const blockedByFailure = pending.filter(n =>
        n.deps.some(dep => nodeState.get(dep) === STATES.FAILED)
      );

      if (ready.length === 0) {
        // All remaining nodes are blocked by failures
        for (const node of blockedByFailure) {
          if (node.critical !== false) {
            throw new Error(`DAG: node "${node.id}" blocked by failed dep. Critical failure.`);
          }
          nodeState.set(node.id, STATES.FAILED);
          partialFailures.push(node.id);
        }
        if (pending.filter(n => nodeState.get(n.id) === STATES.PENDING).length === 0) break;
        await sleep(10);
        continue;
      }

      // Launch all ready nodes in parallel
      await Promise.all(ready.map(async (node) => {
        nodeState.set(node.id, STATES.RUNNING);
        const start    = Date.now();
        const maxRetry = node.retry ?? 0;
        const backoff  = node.backoff ?? 200;
        let attempts   = 0;
        let lastErr;

        while (attempts <= maxRetry) {
          try {
            await node.run(ctx);
            nodeState.set(node.id, STATES.DONE);
            trace.push({ id: node.id, status: 'DONE', durationMs: Date.now() - start, attempts: attempts + 1 });
            return;
          } catch (err) {
            lastErr  = err;
            attempts++;
            if (attempts <= maxRetry) {
              await sleep(backoff * Math.pow(2, attempts - 1));
            }
          }
        }

        // Node failed all retries
        nodeState.set(node.id, STATES.FAILED);
        trace.push({ id: node.id, status: 'FAILED', durationMs: Date.now() - start, attempts, error: lastErr?.message });

        if (node.critical !== false) {
          throw new Error(`DAG: critical node "${node.id}" failed after ${attempts} attempt(s): ${lastErr?.message}`);
        }
        partialFailures.push(node.id);
      }));
    }

    return { trace, partialFailures, ctx };
  }

  _validateGraph(nodes, nodeMap) {
    // Check all deps exist
    for (const node of nodes) {
      for (const dep of (node.deps || [])) {
        if (!nodeMap.has(dep)) {
          throw new Error(`DAG: node "${node.id}" has unknown dep "${dep}"`);
        }
      }
    }
    // Detect cycles (DFS)
    const visited   = new Set();
    const inStack   = new Set();

    const dfs = (id) => {
      if (inStack.has(id)) throw new Error(`DAG: cycle detected at node "${id}"`);
      if (visited.has(id)) return;
      visited.add(id);
      inStack.add(id);
      const node = nodeMap.get(id);
      for (const dep of (node.deps || [])) dfs(dep);
      inStack.delete(id);
    };

    for (const node of nodes) dfs(node.id);
  }
}

module.exports = DAGExecutor;
