#!/usr/bin/env node
/**
 * Runtime dependency audit for packaged Electron builds.
 *
 * Fails on high/critical except advisories with no upstream fix yet.
 * Usage: node scripts/audit-runtime.mjs
 */

import { execSync } from 'node:child_process';

/** GHSA IDs with no fixed release at audit time (document why). */
const ALLOWED_UNFIXED = new Set([
  // brace-expansion DoS (exponential {} expansion). All resolvable copies are
  // forced to fixed versions via package.json overrides; the ONLY remaining
  // vulnerable copy is bundled inside @earendil-works/pi-coding-agent@0.80.3's
  // tarball (bundled deps are not overridable by npm). Exit plan: bump the pi
  // SDK to >=0.81 (planned maintenance — patches/ must be regenerated).
  // Local-only DoS surface (glob patterns), no network exposure.
  'GHSA-3JXR-9VMJ-R5CP',
]);

function loadAudit() {
  try {
    const raw = execSync('npm audit --omit=dev --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? '';
    if (stdout.trim()) {
      return JSON.parse(stdout);
    }
    throw error;
  }
}

function collectAdvisories(audit) {
  const advisories = [];
  for (const vuln of Object.values(audit.vulnerabilities ?? {})) {
    if (vuln.dev) continue;
    const via = Array.isArray(vuln.via) ? vuln.via : [];
    for (const entry of via) {
      if (typeof entry === 'object' && entry.url) {
        const match = entry.url.match(/GHSA-[a-z0-9-]+/i);
        if (match) {
          advisories.push({
            name: vuln.name,
            severity: vuln.severity,
            ghsa: match[0].toUpperCase(),
            title: entry.title ?? entry.name ?? vuln.name,
          });
        }
      }
    }
  }
  return advisories;
}

function main() {
  let audit;
  try {
    audit = loadAudit();
  } catch (error) {
    console.error('npm audit failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const advisories = collectAdvisories(audit);
  const blocking = advisories.filter(
    (item) =>
      (item.severity === 'high' || item.severity === 'critical') &&
      !ALLOWED_UNFIXED.has(item.ghsa.toUpperCase())
  );

  const allowed = advisories.filter((item) => ALLOWED_UNFIXED.has(item.ghsa.toUpperCase()));

  if (allowed.length > 0) {
    console.log('Allowed unfixed upstream advisories:');
    for (const item of allowed) {
      console.log(`  - ${item.ghsa} (${item.name}): ${item.title}`);
    }
  }

  if (blocking.length > 0) {
    console.error('Blocking runtime vulnerabilities:');
    for (const item of blocking) {
      console.error(`  - [${item.severity}] ${item.ghsa} (${item.name}): ${item.title}`);
    }
    process.exit(1);
  }

  console.log('Runtime audit passed (high/critical).');
}

main();
