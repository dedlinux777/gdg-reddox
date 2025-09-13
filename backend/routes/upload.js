const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');

const router = express.Router();

// Configure AWS S3 (if available)
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, images, and office documents are allowed.'));
    }
  }
});

/**
 * POST /api/upload/document
 * Upload a document (receipt, invoice, etc.)
 */
router.post('/document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const { transaction_id, document_type = 'receipt' } = req.body;

    // Read file and generate hash
    const fileBuffer = fs.readFileSync(file.path);
    const documentHash = cryptoUtils.hashDocument(fileBuffer);

    let documentUrl = '';
    let storageLocation = 'local';

    // Try to upload to S3 if configured
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      try {
        const s3Key = `documents/${new Date().getFullYear()}/${Date.now()}-${file.originalname}`;
        
        const uploadParams = {
          Bucket: process.env.AWS_BUCKET_NAME || 'transparency-documents',
          Key: s3Key,
          Body: fileBuffer,
          ContentType: file.mimetype,
          Metadata: {
            'original-name': file.originalname,
            'document-type': document_type,
            'transaction-id': transaction_id || '',
            'upload-timestamp': new Date().toISOString(),
            'document-hash': documentHash,
          }
        };

        const s3Result = await s3.upload(uploadParams).promise();
        documentUrl = s3Result.Location;
        storageLocation = 's3';

        // Delete local file after successful S3 upload
        fs.unlinkSync(file.path);

        logger.info(`Document uploaded to S3: ${s3Key}`);
      } catch (s3Error) {
        logger.warn('S3 upload failed, using local storage:', s3Error.message);
        documentUrl = `/uploads/${file.filename}`;
        storageLocation = 'local';
      }
    } else {
      // Use local storage
      documentUrl = `/uploads/${file.filename}`;
      storageLocation = 'local';
    }

    const uploadResult = {
      id: cryptoUtils.generateSecureToken(16),
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      documentUrl,
      documentHash,
      documentType: document_type,
      storageLocation,
      uploadedAt: new Date().toISOString(),
      transactionId: transaction_id || null,
    };

    logger.info(`Document uploaded: ${file.originalname} (${file.size} bytes)`);

    res.json({
      success: true,
      document: uploadResult,
      message: 'Document uploaded successfully',
    });

  } catch (error) {
    logger.error('Error uploading document:', error);
    
    // Clean up local file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * GET /api/upload/document/:filename
 * Serve uploaded documents (for local storage)
 */
router.get('/document/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads', filename);

    // Security check - ensure file exists and is within uploads directory
    if (!fs.existsSync(filePath) || !filePath.startsWith(path.join(__dirname, '../uploads'))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Set appropriate headers
    const stat = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    
    let contentType = 'application/octet-stream';
    switch (ext) {
      case '.pdf':
        contentType = 'application/pdf';
        break;
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    logger.error('Error serving document:', error);
    res.status(500).json({ error: 'Failed to serve document' });
  }
});

/**
 * POST /api/upload/verify-document
 * Verify document integrity using hash
 */
router.post('/verify-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded for verification' });
    }

    const { expected_hash } = req.body;

    if (!expected_hash) {
      return res.status(400).json({ error: 'Expected hash is required' });
    }

    // Read file and generate hash
    const fileBuffer = fs.readFileSync(req.file.path);
    const computedHash = cryptoUtils.hashDocument(fileBuffer);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    const isValid = computedHash === expected_hash;

    res.json({
      isValid,
      expectedHash: expected_hash,
      computedHash,
      filename: req.file.originalname,
      verifiedAt: new Date().toISOString(),
      status: isValid ? 'verified' : 'tampered',
    });

  } catch (error) {
    logger.error('Error verifying document:', error);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: 'Failed to verify document' });
  }
});

/**
 * GET /api/upload/stats
 * Get upload statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../uploads');
    let localFiles = [];
    let totalLocalSize = 0;

    if (fs.existsSync(uploadDir)) {
      localFiles = fs.readdirSync(uploadDir);
      totalLocalSize = localFiles.reduce((total, filename) => {
        const filePath = path.join(uploadDir, filename);
        const stat = fs.statSync(filePath);
        return total + stat.size;
      }, 0);
    }

    const stats = {
      localStorage: {
        fileCount: localFiles.length,
        totalSize: totalLocalSize,
        totalSizeMB: Math.round(totalLocalSize / (1024 * 1024) * 100) / 100,
      },
      s3Storage: {
        configured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
        bucketName: process.env.AWS_BUCKET_NAME || 'transparency-documents',
      },
      limits: {
        maxFileSize: '10MB',
        allowedTypes: [
          'PDF', 'JPEG', 'PNG', 'GIF', 
          'Word Documents', 'Excel Spreadsheets'
        ],
      },
      generatedAt: new Date().toISOString(),
    };

    res.json(stats);

  } catch (error) {
    logger.error('Error getting upload stats:', error);
    res.status(500).json({ error: 'Failed to get upload statistics' });
  }
});

module.exports = router;
