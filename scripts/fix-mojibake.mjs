#!/usr/bin/env node
// Repair UTF-8-double-encoded characters across the source tree.
//
// The repository's source files were once read as Windows-1252 and re-saved as
// UTF-8, which mangled every multi-byte character. This script reverses that:
// for each known intended character, it computes the exact mojibake sequence
// (utf8Bytes -> windows-1252 string) and replaces it.
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['client/src', 'server/src', 'shared', 'client/public/sw.js', 'client/index.html'];
const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.md']);

const decoder = new TextDecoder('windows-1252');

// Every character that legitimately appears in the source as a non-ASCII glyph,
// expressed as Unicode code points to keep this script ASCII-clean.
const INTENDED_CHARS = [
  '✦', // ✦ sparkle
  '✓', // ✓ check
  '✕', // ✕ multiplication X
  '✗', // ✗ ballot X
  '✅', // ✅ white heavy check
  '⚠', // ⚠ warning
  '●', // ● black circle
  '○', // ○ white circle
  '◦', // ◦ white bullet
  '—', // — em dash
  '–', // – en dash
  '…', // … ellipsis
  '•', // • bullet
  '‹', // ‹ left guillemet
  '›', // › right guillemet
  '‘', // ' left single quote
  '’', // ' right single quote
  '“', // " left double quote
  '”', // " right double quote
  '„', // „ low double quote
  '‚', // ‚ low single quote
  '←', // ← left arrow
  '→', // → right arrow
  '↑', // ↑ up arrow
  '↓', // ↓ down arrow
  '↔', // ↔ left-right arrow
  '↕', // ↕ up-down arrow
  '►', // ► black right pointer
  '▼', // ▼ black down triangle
  '▲', // ▲ black up triangle
  '◄', // ◄ black left pointer
  '°', // ° degree
  '±', // ± plus-minus
  '×', // × multiplication
  '÷', // ÷ division
  'é', // é
  'è', // è
  'á', // á
  'à', // à
  'ñ', // ñ
  'ü', // ü
  // Box drawing characters used in section dividers
  '─', '━', '│', '┃',
  '┌', '┐', '└', '┘',
  '├', '┤', '┬', '┴', '┼',
  '═', '║', '╔', '╗', '╚', '╝',
  // Math / inequality
  '≥', '≤', '≠', '≈', '∞', '∑', '∂', '∆', '∫',
  // Geometric / status icons
  '☐', '☑', '☒', '☀', '☁', '☂', '☃',
  '⏰', '⏱', '⏲', '⏳', '⏸', '⏹', '⏺',
  '⌘', '⌥', '⌃', '⌕', '⌚',
  '⊞', '⊟', '⊠', '⊡', '⊙', '⊘', '⊛',
  '◑', '◐', '◒', '◓',
  // Emoji (4-byte UTF-8 still works through the same transform)
  '🎤', '📎', '🎯', '🎉', '🚀', '⭐', '🔥', '💡', '📌', '📝', '🔔', '🔍',
  '✨', '🌟', '⚡', '🌈', '🎨', '🎭',
  '🚫', '🔒', '🔓', '🔕', '🔔', '🧠', '📋', '💬', '📄', '📥', '📤', '🏆',
  '📊', '📈', '📉', '📅', '📆', '💰', '💸', '💵', '⚙', '🛠', '🔧',
  '✉', '📧', '📨', '📩', '📞', '📱', '💻', '🖥', '⌨', '🖱',
  '👤', '👥', '🏠', '🏢', '⏰', '⏳', '📍', '🌐',
];

const REPLACEMENTS = INTENDED_CHARS.map((char) => {
  const utf8Bytes = Buffer.from(char, 'utf8');
  const mojibake = decoder.decode(utf8Bytes);
  return [mojibake, char];
}).sort((a, b) => b[0].length - a[0].length); // longest first to avoid partial matches

function* walk(target) {
  let stat;
  try { stat = statSync(target); } catch { return; }
  if (stat.isFile()) {
    if (EXTS.has(extname(target))) yield target;
    return;
  }
  for (const entry of readdirSync(target)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    yield* walk(join(target, entry));
  }
}

let filesChanged = 0;
let totalReplacements = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    let content = readFileSync(file, 'utf8');
    const original = content;
    let count = 0;
    for (const [bad, good] of REPLACEMENTS) {
      if (bad === good) continue;
      if (content.includes(bad)) {
        const occurrences = content.split(bad).length - 1;
        content = content.split(bad).join(good);
        count += occurrences;
      }
    }
    if (content !== original) {
      writeFileSync(file, content, 'utf8');
      filesChanged++;
      totalReplacements += count;
      console.log(`fixed ${file} (${count})`);
    }
  }
}

console.log(`\n${filesChanged} files updated, ${totalReplacements} sequences replaced.`);
