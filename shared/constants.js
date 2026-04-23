/**
 * Shared constants and types for Flowra.
 */

const SOURCES = {
  MANUAL: 'manual',
  CALENDAR: 'calendar',
  GMAIL: 'gmail',
  NOTION: 'notion',
};

const SENTIMENTS = {
  FOCUSED: 'focused',
  STRESSED: 'stressed',
  NEUTRAL: 'neutral',
  PRODUCTIVE: 'productive',
  OVERWHELMED: 'overwhelmed',
};

const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 10000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

module.exports = {
  SOURCES,
  SENTIMENTS,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  MAX_TEXT_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
