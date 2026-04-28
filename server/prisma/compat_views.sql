-- ✦ Flowra — Compatibility Views
-- Creates lowercase-named views over Prisma-managed PascalCase tables
-- so that the raw SQL services (entry.service.js, etc.) work correctly.

-- extracted_states view
DROP VIEW IF EXISTS extracted_states;
CREATE VIEW extracted_states AS
  SELECT
    id,
    "entryId"     AS entry_id,
    "actionItems" AS action_items,
    blockers,
    deadlines,
    completions,
    tags,
    sentiment,
    "processedAt" AS processed_at
  FROM "ExtractedState";

-- file_attachments view
DROP VIEW IF EXISTS file_attachments;
CREATE VIEW file_attachments AS
  SELECT
    id,
    "entryId"       AS entry_id,
    "fileName"      AS file_name,
    "fileType"      AS file_type,
    "fileSize"      AS file_size,
    "fileKey"       AS file_key,
    "fileUrl"       AS s3_url,
    "extractedText" AS extracted_text,
    "createdAt"     AS created_at
  FROM "FileAttachment";
