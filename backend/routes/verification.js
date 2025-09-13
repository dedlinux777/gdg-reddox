const express = require('express');
const { pool } = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const QRCode = require('qrcode');

const router = express.Router();

/**
 * GET /api/verify/:recordType/:recordId
 * Verify the integrity and authenticity of a record
 */
router.get('/:recordType/:recordId', async (req, res) => {
  try {
    const { recordType, recordId } = req.params;
    
    // Validate record type
    const validTypes = ['budget', 'project', 'vendor', 'transaction'];
    if (!validTypes.includes(recordType)) {
      return res.status(400).json({ error: 'Invalid record type' });
    }

    // Get table name from record type
    const tableMap = {
      budget: 'budgets',
      project: 'projects', 
      vendor: 'vendors',
      transaction: 'transactions'
    };
    
    const tableName = tableMap[recordType];

    // Fetch the record
    const recordQuery = `SELECT * FROM ${tableName} WHERE id = $1`;
    const recordResult = await pool.query(recordQuery, [recordId]);

    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const record = recordResult.rows[0];

    // Fetch related approvals/signatures
    const approvalsQuery = `
      SELECT * FROM approvals 
      WHERE related_record_id = $1 AND related_record_type = $2
      ORDER BY signed_at DESC
    `;
    const approvalsResult = await pool.query(approvalsQuery, [recordId, recordType]);
    const approvals = approvalsResult.rows;

    // Perform complete verification
    const verification = await cryptoUtils.completeVerification(
      record,
      record.record_hash,
      approvals
    );

    // Get verification history
    const historyQuery = `
      SELECT 
        action,
        old_values,
        new_values,
        changed_by,
        changed_at,
        ip_address
      FROM audit_log 
      WHERE table_name = $1 AND record_id = $2
      ORDER BY changed_at DESC
      LIMIT 10
    `;
    const historyResult = await pool.query(historyQuery, [tableName, recordId]);

    // Generate verification report
    const verificationReport = {
      recordId,
      recordType,
      record: {
        ...record,
        // Remove sensitive internal fields from public verification
        canonical_json: undefined,
      },
      verification,
      approvals: approvals.map(approval => ({
        approver: {
          name: approval.approver_name,
          role: approval.approver_role,
          email: approval.approver_email,
        },
        signedAt: approval.signed_at,
        status: approval.approval_status,
        comments: approval.comments,
        // Don't expose actual signature and keys in public API
        hasValidSignature: verification.signatureVerifications.find(
          sig => sig.signer.name === approval.approver_name
        )?.isValid || false,
      })),
      auditTrail: historyResult.rows,
      verificationSummary: {
        overallStatus: verification.verificationStatus,
        hashIntegrity: verification.hashVerification.isValid,
        signatureCount: approvals.length,
        validSignatures: verification.signatureVerifications.filter(sig => sig.isValid).length,
        lastVerified: verification.verifiedAt,
      },
      metadata: {
        verifiedAt: new Date().toISOString(),
        verificationMethod: 'SHA-256 + RSA Digital Signatures',
        apiVersion: '1.0',
      },
    };

    res.json(verificationReport);

  } catch (error) {
    logger.error('Error verifying record:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/verify/batch
 * Verify multiple records at once
 */
router.post('/batch', async (req, res) => {
  try {
    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Records array is required' });
    }

    if (records.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 records allowed per batch' });
    }

    const verificationResults = [];

    for (const { recordType, recordId } of records) {
      try {
        // Reuse the single verification logic
        const singleVerification = await fetch(`${req.protocol}://${req.get('host')}/api/verify/${recordType}/${recordId}`);
        const result = await singleVerification.json();
        
        verificationResults.push({
          recordId,
          recordType,
          status: result.verificationSummary?.overallStatus || 'error',
          verified: result.verification?.overallValid || false,
          error: result.error || null,
        });
      } catch (error) {
        verificationResults.push({
          recordId,
          recordType,
          status: 'error',
          verified: false,
          error: error.message,
        });
      }
    }

    const summary = {
      totalRecords: records.length,
      verified: verificationResults.filter(r => r.verified).length,
      pending: verificationResults.filter(r => r.status === 'pending').length,
      suspicious: verificationResults.filter(r => r.status === 'suspicious').length,
      errors: verificationResults.filter(r => r.status === 'error').length,
    };

    res.json({
      results: verificationResults,
      summary,
      verifiedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Error in batch verification:', error);
    res.status(500).json({ error: 'Batch verification failed' });
  }
});

/**
 * GET /api/verify/:recordType/:recordId/qr
 * Generate QR code for record verification
 */
router.get('/:recordType/:recordId/qr', async (req, res) => {
  try {
    const { recordType, recordId } = req.params;
    const { format = 'png', size = 200 } = req.query;

    // Generate QR code data
    const qrData = cryptoUtils.generateVerificationQR(recordId, recordType);

    // Generate QR code image
    const qrOptions = {
      width: parseInt(size),
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    };

    if (format === 'svg') {
      const qrSvg = await QRCode.toString(qrData.url, { 
        ...qrOptions, 
        type: 'svg' 
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(qrSvg);
    } else {
      const qrBuffer = await QRCode.toBuffer(qrData.url, {
        ...qrOptions,
        type: 'png',
      });
      res.setHeader('Content-Type', 'image/png');
      res.send(qrBuffer);
    }

  } catch (error) {
    logger.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

/**
 * GET /api/verify/:recordType/:recordId/certificate
 * Generate verification certificate (detailed report)
 */
router.get('/:recordType/:recordId/certificate', async (req, res) => {
  try {
    const { recordType, recordId } = req.params;

    // Get full verification data
    const verificationResponse = await fetch(`${req.protocol}://${req.get('host')}/api/verify/${recordType}/${recordId}`);
    const verificationData = await verificationResponse.json();

    if (!verificationResponse.ok) {
      return res.status(verificationResponse.status).json(verificationData);
    }

    // Generate detailed certificate
    const certificate = {
      certificateId: cryptoUtils.generateSecureToken(16),
      issuedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      
      subject: {
        recordId: verificationData.recordId,
        recordType: verificationData.recordType,
        title: getRecordTitle(verificationData.record, recordType),
      },

      verification: {
        status: verificationData.verificationSummary.overallStatus,
        method: 'SHA-256 Hash + RSA-2048 Digital Signatures',
        hashAlgorithm: 'SHA-256',
        signatureAlgorithm: 'RSA-PKCS1-v1_5',
        
        integrity: {
          hashVerified: verificationData.verificationSummary.hashIntegrity,
          originalHash: verificationData.verification.hashVerification.storedHash,
          computedHash: verificationData.verification.hashVerification.computedHash,
          hashMatch: verificationData.verification.hashVerification.isValid,
        },

        authenticity: {
          totalSignatures: verificationData.verificationSummary.signatureCount,
          validSignatures: verificationData.verificationSummary.validSignatures,
          signers: verificationData.approvals.map(approval => ({
            name: approval.approver.name,
            role: approval.approver.role,
            signedAt: approval.signedAt,
            valid: approval.hasValidSignature,
          })),
        },

        auditTrail: {
          totalChanges: verificationData.auditTrail.length,
          lastModified: verificationData.auditTrail[0]?.changed_at || verificationData.record.created_at,
          changes: verificationData.auditTrail.slice(0, 5), // Last 5 changes
        },
      },

      issuer: {
        name: 'Transparency Verification System',
        authority: 'Government Transparency Initiative',
        publicKey: cryptoUtils.publicKey,
      },

      verificationUrl: `${req.protocol}://${req.get('host')}/api/verify/${recordType}/${recordId}`,
      
      disclaimer: 'This certificate verifies the cryptographic integrity and authenticity of the referenced record at the time of issuance. The verification is based on SHA-256 hashing and RSA digital signatures.',
    };

    res.json(certificate);

  } catch (error) {
    logger.error('Error generating verification certificate:', error);
    res.status(500).json({ error: 'Failed to generate verification certificate' });
  }
});

/**
 * GET /api/verify/statistics
 * Get overall verification statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;

    // Calculate date range
    let dateFilter = '';
    const timeframes = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365,
    };

    if (timeframes[timeframe]) {
      const daysAgo = timeframes[timeframe];
      dateFilter = `AND created_at >= NOW() - INTERVAL '${daysAgo} days'`;
    }

    // Get verification statistics for all record types
    const statsQuery = `
      SELECT 
        'budgets' as record_type,
        verification_status,
        COUNT(*) as count
      FROM budgets 
      WHERE 1=1 ${dateFilter}
      GROUP BY verification_status
      
      UNION ALL
      
      SELECT 
        'projects' as record_type,
        verification_status,
        COUNT(*) as count
      FROM projects 
      WHERE 1=1 ${dateFilter}
      GROUP BY verification_status
      
      UNION ALL
      
      SELECT 
        'vendors' as record_type,
        verification_status,
        COUNT(*) as count
      FROM vendors 
      WHERE 1=1 ${dateFilter}
      GROUP BY verification_status
      
      UNION ALL
      
      SELECT 
        'transactions' as record_type,
        verification_status,
        COUNT(*) as count
      FROM transactions 
      WHERE 1=1 ${dateFilter}
      GROUP BY verification_status
    `;

    const statsResult = await pool.query(statsQuery);

    // Process statistics
    const statistics = {
      timeframe,
      generatedAt: new Date().toISOString(),
      
      overall: {
        verified: 0,
        pending: 0,
        suspicious: 0,
        total: 0,
      },

      byRecordType: {
        budgets: { verified: 0, pending: 0, suspicious: 0, total: 0 },
        projects: { verified: 0, pending: 0, suspicious: 0, total: 0 },
        vendors: { verified: 0, pending: 0, suspicious: 0, total: 0 },
        transactions: { verified: 0, pending: 0, suspicious: 0, total: 0 },
      },
    };

    statsResult.rows.forEach(row => {
      const count = parseInt(row.count);
      const recordType = row.record_type;
      const status = row.verification_status;

      // Update overall statistics
      statistics.overall[status] += count;
      statistics.overall.total += count;

      // Update by record type
      statistics.byRecordType[recordType][status] += count;
      statistics.byRecordType[recordType].total += count;
    });

    // Calculate percentages
    Object.keys(statistics.byRecordType).forEach(recordType => {
      const typeStats = statistics.byRecordType[recordType];
      if (typeStats.total > 0) {
        typeStats.verifiedPercentage = Math.round((typeStats.verified / typeStats.total) * 100);
        typeStats.pendingPercentage = Math.round((typeStats.pending / typeStats.total) * 100);
        typeStats.suspiciousPercentage = Math.round((typeStats.suspicious / typeStats.total) * 100);
      }
    });

    if (statistics.overall.total > 0) {
      statistics.overall.verifiedPercentage = Math.round((statistics.overall.verified / statistics.overall.total) * 100);
      statistics.overall.pendingPercentage = Math.round((statistics.overall.pending / statistics.overall.total) * 100);
      statistics.overall.suspiciousPercentage = Math.round((statistics.overall.suspicious / statistics.overall.total) * 100);
    }

    res.json(statistics);

  } catch (error) {
    logger.error('Error fetching verification statistics:', error);
    res.status(500).json({ error: 'Failed to fetch verification statistics' });
  }
});

/**
 * Helper function to get record title for certificate
 */
function getRecordTitle(record, recordType) {
  switch (recordType) {
    case 'budget':
      return `${record.department} Budget ${record.year}`;
    case 'project':
      return record.project_name;
    case 'vendor':
      return record.vendor_name;
    case 'transaction':
      return `Transaction $${record.amount} - ${record.description?.substring(0, 50)}...`;
    default:
      return 'Unknown Record';
  }
}

module.exports = router;
