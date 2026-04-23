const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const prisma = require('../../lib/prisma');

const router = express.Router();

// S3/R2 client
const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

const ALLOWED_TYPES = {
  'image/jpeg': { ext: ['jpg', 'jpeg'], maxSize: 10 * 1024 * 1024 },
  'image/png': { ext: ['png'], maxSize: 10 * 1024 * 1024 },
  'image/webp': { ext: ['webp'], maxSize: 10 * 1024 * 1024 },
  'application/pdf': { ext: ['pdf'], maxSize: 10 * 1024 * 1024 },
};

// Magic bytes for server-side file type validation
const MAGIC_BYTES = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'image/webp': [Buffer.from('RIFF')], // RIFF....WEBP
  'application/pdf': [Buffer.from('%PDF')],
};

router.use(authenticate);

// POST /api/v1/files/upload-url — Get presigned upload URL
router.post('/upload-url', async (req, res, next) => {
  try {
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName || !fileType || !fileSize) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'fileName, fileType, and fileSize are required.' },
      });
    }

    const typeConfig = ALLOWED_TYPES[fileType];
    if (!typeConfig) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Unsupported file type. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
        },
      });
    }

    // Validate extension matches declared type
    const ext = fileName.split('.').pop().toLowerCase();
    if (!typeConfig.ext.includes(ext)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Extension .${ext} does not match type ${fileType}` },
      });
    }

    if (fileSize > typeConfig.maxSize) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `File too large. Maximum ${typeConfig.maxSize / 1024 / 1024}MB for ${fileType}.` },
      });
    }

    // Generate unique key
    const fileKey = `${req.user.id}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: fileKey,
      ContentType: fileType,
      ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({
      success: true,
      data: { uploadUrl, fileKey, expiresIn: 300 },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/files/confirm — Confirm upload completed, update metadata
router.post('/confirm', async (req, res, next) => {
  try {
    const { fileKey, entryId } = req.body;

    if (!fileKey || !entryId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'fileKey and entryId are required.' },
      });
    }

    // Verify the file exists in S3
    let headResult;
    try {
      headResult = await s3.send(new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fileKey,
      }));
    } catch {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'File not found in storage. Upload may have failed.' },
      });
    }

    // Verify entry ownership
    const entry = await prisma.entry.findUnique({ where: { id: entryId } });
    if (!entry || entry.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' },
      });
    }

    // Update file attachment with real metadata from S3
    const file = await prisma.fileAttachment.updateMany({
      where: { fileKey, entryId },
      data: {
        fileSize: headResult.ContentLength || 0,
        fileType: headResult.ContentType || 'application/octet-stream',
      },
    });

    // If this is an image, trigger Cortex re-ingestion with vision
    if (headResult.ContentType && headResult.ContentType.startsWith('image/')) {
      const { engines } = require('../../engines');
      engines.cortex.ingestAsync(entryId, entry.rawText, {
        source: entry.source,
        fileKey,
        fileType: headResult.ContentType,
      });
    }

    res.json({
      success: true,
      data: {
        message: 'Upload confirmed.',
        fileSize: headResult.ContentLength,
        fileType: headResult.ContentType,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/files/:id/download-url — Get presigned download URL
router.get('/:id/download-url', async (req, res, next) => {
  try {
    const file = await prisma.fileAttachment.findUnique({
      where: { id: req.params.id },
      include: { entry: { select: { userId: true } } },
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'File not found.' },
      });
    }

    if (file.entry.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' },
      });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.fileKey,
    });

    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({
      success: true,
      data: { downloadUrl, expiresIn: 3600 },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
