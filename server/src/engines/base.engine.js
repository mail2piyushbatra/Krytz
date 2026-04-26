/**
 * ✦ BASE ENGINE — v2
 *
 * Abstract base class for all Flowra engines.
 *
 * Upgrades from v1:
 *   - p50/p95 latency tracking (sliding window, 1000 samples)
 *   - Error rate + circuit breaker (auto-opens at 30% error rate)
 *   - Cost tracking per engine (USD, tokens)
 *   - Throughput counter (calls/min)
 *   - Structured health output
 */

'use strict';

// ─── Percentile helper ────────────────────────────────────────────────────────
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx    = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

class BaseEngine {
  constructor(name) {
    this.name        = name;
    this.initialized = false;
    this.startedAt   = null;

    // ── Call stats ──────────────────────────────────────────────
    this._stats = {
      totalCalls:   0,
      totalErrors:  0,
      totalSuccess: 0,
      lastCallAt:   null,
    };

    // ── Latency tracking (sliding window) ──────────────────────
    this._latencies  = [];           // ms values, capped at 1000
    this._windowSize = 1000;

    // ── Cost tracking ───────────────────────────────────────────
    this._cost = {
      inputTokens:  0,
      outputTokens: 0,
      usd:          0,
    };

    // ── Circuit breaker ─────────────────────────────────────────
    this._circuit = {
      open:         false,
      openedAt:     null,
      cooldownMs:   30_000,      // 30s before auto-reset
      threshold:    0.30,        // trip at 30% error rate
      minSamples:   10,          // need at least 10 calls before tripping
    };

    // ── Throughput ──────────────────────────────────────────────
    this._callTimestamps = [];   // last 60s of call timestamps
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async initialize() {
    this.initialized = true;
    this.startedAt   = new Date();
  }

  ensureReady() {
    if (!this.initialized) {
      throw new Error(`${this.name} engine is not initialized. Call initialize() first.`);
    }
  }

  // ─── Observability ────────────────────────────────────────────────────────

  /**
   * Call at the START of every engine operation.
   * Returns a done() function — call it when the operation completes.
   *
   * Usage:
   *   const done = this.startCall();
   *   try { ... result ... done(); return result; }
   *   catch(e) { done(e); throw e; }
   */
  startCall() {
    this.ensureReady();
    this._checkCircuitBreaker();

    const start = Date.now();
    this._stats.totalCalls++;
    this._stats.lastCallAt = new Date();

    // Throughput: record timestamp, prune > 60s old
    const now = Date.now();
    this._callTimestamps.push(now);
    this._callTimestamps = this._callTimestamps.filter(t => now - t < 60_000);

    return (err) => {
      const ms = Date.now() - start;
      this._recordLatency(ms);

      if (err) {
        this._stats.totalErrors++;
        this._maybeOpenCircuit();
      } else {
        this._stats.totalSuccess++;
      }
    };
  }

  // Legacy shims (keep existing callers working)
  trackCall()  { this._stats.totalCalls++;  this._stats.lastCallAt = new Date(); }
  trackError() { this._stats.totalErrors++; }

  /**
   * Record cost for operations that consume tokens / money.
   */
  recordCost({ inputTokens = 0, outputTokens = 0, usd = 0 } = {}) {
    this._cost.inputTokens  += inputTokens;
    this._cost.outputTokens += outputTokens;
    this._cost.usd          += usd;
  }

  getHealth() {
    const errorRate = this._stats.totalCalls > 0
      ? this._stats.totalErrors / this._stats.totalCalls
      : 0;

    return {
      name:        this.name,
      initialized: this.initialized,
      startedAt:   this.startedAt,
      uptime:      this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      stats: {
        totalCalls:   this._stats.totalCalls,
        totalErrors:  this._stats.totalErrors,
        totalSuccess: this._stats.totalSuccess,
        lastCallAt:   this._stats.lastCallAt,
        errorRate:    parseFloat(errorRate.toFixed(3)),
      },
      latency: {
        p50: percentile(this._latencies, 50),
        p95: percentile(this._latencies, 95),
        p99: percentile(this._latencies, 99),
      },
      throughput: {
        callsPerMinute: this._callTimestamps.length,
      },
      circuit: {
        open:     this._circuit.open,
        openedAt: this._circuit.openedAt,
      },
      cost: { ...this._cost },
    };
  }

  // ─── Circuit breaker ──────────────────────────────────────────────────────

  _checkCircuitBreaker() {
    if (!this._circuit.open) return;

    // Auto-reset after cooldown
    if (Date.now() - this._circuit.openedAt > this._circuit.cooldownMs) {
      this._circuit.open     = false;
      this._circuit.openedAt = null;
      return; // allow call through (half-open)
    }

    throw new Error(`${this.name} circuit breaker is OPEN. Too many recent failures. Retry in ${
      Math.round((this._circuit.cooldownMs - (Date.now() - this._circuit.openedAt)) / 1000)
    }s.`);
  }

  _maybeOpenCircuit() {
    const total = this._stats.totalCalls;
    if (total < this._circuit.minSamples) return;

    const errorRate = this._stats.totalErrors / total;
    if (errorRate >= this._circuit.threshold && !this._circuit.open) {
      this._circuit.open     = true;
      this._circuit.openedAt = Date.now();
    }
  }

  // ─── Latency ──────────────────────────────────────────────────────────────

  _recordLatency(ms) {
    this._latencies.push(ms);
    if (this._latencies.length > this._windowSize) {
      this._latencies.shift();
    }
  }
}

module.exports = BaseEngine;
