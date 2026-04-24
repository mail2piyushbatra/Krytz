const { S3Client, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const logger = require('../../lib/logger');

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;

/**
 * Delete a single file from S3/R2.
 */
async function deleteFileFromS3(fileKey) {
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
    }));
    logger.info('Deleted file from S3', { fileKey });
  } catch (err) {
    logger.error('Failed to delete file from S3', { fileKey, error: err });
    // Don't throw — file deletion failure should not block DB operations.
    // The file becomes orphaned but the user experience is not affected.
  }
}

/**
 * Delete multiple files from S3/R2 in a batch.
 * S3 supports batch deletion of up to 1000 objects per request.
 */
async function deleteFilesFromS3(fileKeys) {
  if (!fileKeys || fileKeys.length === 0) return;

  // S3 batch delete supports up to 1000 keys per request
  const BATCH_SIZE = 1000;

  for (let i = 0; i < fileKeys.length; i += BATCH_SIZE) {
    const batch = fileKeys.slice(i, i + BATCH_SIZE);

    try {
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }));
      logger.info('Batch deleted files from S3', { count: batch.length });
    } catch (err) {
      logger.error('Batch delete failed, falling back to individual', { count: batch.length, error: err });
      // Fallback: try deleting individually
      for (const key of batch) {
        await deleteFileFromS3(key);
      }
    }
  }
}

module.exports = { deleteFileFromS3, deleteFilesFromS3 };
