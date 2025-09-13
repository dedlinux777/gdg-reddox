const express = require('express');
const { pool } = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Validation schema
const transactionSchema = Joi.object({
  project_id: Joi.string().uuid().required(),
  vendor_id: Joi.string().uuid().allow(null),
  transaction_type: Joi.string().valid('payment', 'expense', 'refund', 'adjustment').required(),
  amount: Joi.number().not(0).required(),
  transaction_date: Joi.date().required(),
  description: Joi.string().allow('').max(1000),
  document_url: Joi.string().uri().allow('').max(500),
});

/**
 * GET /api/transactions
 * Get all transactions with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { 
      project_id,
      vendor_id,
      transaction_type,
      verification_status, 
      page = 1, 
      limit = 20,
      from_date,
      to_date,
      min_amount,
      max_amount
    } = req.query;

    let query = `
      SELECT 
        t.*,
        p.project_name,
        v.vendor_name,
        b.department,
        b.year
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      LEFT JOIN vendors v ON t.vendor_id = v.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    // Add filters
    if (project_id) {
      paramCount++;
      query += ` AND t.project_id = $${paramCount}`;
      queryParams.push(project_id);
    }

    if (vendor_id) {
      paramCount++;
      query += ` AND t.vendor_id = $${paramCount}`;
      queryParams.push(vendor_id);
    }

    if (transaction_type) {
      paramCount++;
      query += ` AND t.transaction_type = $${paramCount}`;
      queryParams.push(transaction_type);
    }

    if (verification_status) {
      paramCount++;
      query += ` AND t.verification_status = $${paramCount}`;
      queryParams.push(verification_status);
    }

    if (from_date) {
      paramCount++;
      query += ` AND t.transaction_date >= $${paramCount}`;
      queryParams.push(from_date);
    }

    if (to_date) {
      paramCount++;
      query += ` AND t.transaction_date <= $${paramCount}`;
      queryParams.push(to_date);
    }

    if (min_amount) {
      paramCount++;
      query += ` AND ABS(t.amount) >= $${paramCount}`;
      queryParams.push(min_amount);
    }

    if (max_amount) {
      paramCount++;
      query += ` AND ABS(t.amount) <= $${paramCount}`;
      queryParams.push(max_amount);
    }

    query += ` ORDER BY t.transaction_date DESC, t.amount DESC`;

    // Add pagination
    const offset = (page - 1) * limit;
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limit);

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) 
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 0;

    // Apply same filters for count
    if (project_id) {
      countParamCount++;
      countQuery += ` AND t.project_id = $${countParamCount}`;
      countParams.push(project_id);
    }

    if (vendor_id) {
      countParamCount++;
      countQuery += ` AND t.vendor_id = $${countParamCount}`;
      countParams.push(vendor_id);
    }

    if (transaction_type) {
      countParamCount++;
      countQuery += ` AND t.transaction_type = $${countParamCount}`;
      countParams.push(transaction_type);
    }

    if (verification_status) {
      countParamCount++;
      countQuery += ` AND t.verification_status = $${countParamCount}`;
      countParams.push(verification_status);
    }

    if (from_date) {
      countParamCount++;
      countQuery += ` AND t.transaction_date >= $${countParamCount}`;
      countParams.push(from_date);
    }

    if (to_date) {
      countParamCount++;
      countQuery += ` AND t.transaction_date <= $${countParamCount}`;
      countParams.push(to_date);
    }

    if (min_amount) {
      countParamCount++;
      countQuery += ` AND ABS(t.amount) >= $${countParamCount}`;
      countParams.push(min_amount);
    }

    if (max_amount) {
      countParamCount++;
      countQuery += ` AND ABS(t.amount) <= $${countParamCount}`;
      countParams.push(max_amount);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      transactions: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasNext: page * limit < totalCount,
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/transactions/:id
 * Get a specific transaction by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const transactionQuery = `
      SELECT 
        t.*,
        p.project_name,
        p.allocated_amount as project_budget,
        v.vendor_name,
        v.contact_email as vendor_email,
        b.department,
        b.year
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      LEFT JOIN vendors v ON t.vendor_id = v.id
      WHERE t.id = $1
    `;

    const result = await pool.query(transactionQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = result.rows[0];

    // Get approvals
    const approvalsQuery = `
      SELECT * FROM approvals 
      WHERE related_record_id = $1 AND related_record_type = 'transaction'
      ORDER BY signed_at DESC
    `;

    const approvalsResult = await pool.query(approvalsQuery, [id]);

    res.json({
      transaction,
      approvals: approvalsResult.rows,
      verification: cryptoUtils.generateVerificationQR(id, 'transaction'),
    });

  } catch (error) {
    logger.error('Error fetching transaction:', error);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

/**
 * POST /api/transactions
 * Create a new transaction
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { error, value } = transactionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const transactionData = value;

    // Verify project exists
    const projectCheck = await client.query('SELECT * FROM projects WHERE id = $1', [transactionData.project_id]);
    if (projectCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Project not found' });
    }

    // Verify vendor exists if provided
    if (transactionData.vendor_id) {
      const vendorCheck = await client.query('SELECT * FROM vendors WHERE id = $1', [transactionData.vendor_id]);
      if (vendorCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Vendor not found' });
      }
    }

    // Hash document if URL provided
    let documentHash = null;
    if (transactionData.document_url) {
      // In a real implementation, you would fetch and hash the document
      documentHash = cryptoUtils.generateSecureToken(32);
    }

    // Generate hash
    const canonicalJson = cryptoUtils.createCanonicalJson(transactionData);
    const recordHash = cryptoUtils.generateHash(transactionData);

    const insertQuery = `
      INSERT INTO transactions (
        project_id, vendor_id, transaction_type, amount, transaction_date, 
        description, document_url, document_hash, record_hash, canonical_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      transactionData.project_id,
      transactionData.vendor_id || null,
      transactionData.transaction_type,
      transactionData.amount,
      transactionData.transaction_date,
      transactionData.description || null,
      transactionData.document_url || null,
      documentHash,
      recordHash,
      canonicalJson,
    ]);

    const newTransaction = result.rows[0];

    // Update project spent amount if it's a payment
    if (transactionData.transaction_type === 'payment' && transactionData.amount > 0) {
      await client.query(`
        UPDATE projects 
        SET spent_amount = spent_amount + $1 
        WHERE id = $2
      `, [transactionData.amount, transactionData.project_id]);
    }

    await client.query('COMMIT');

    logger.info(`New transaction created: ${newTransaction.id} - $${newTransaction.amount}`);

    res.status(201).json({
      transaction: newTransaction,
      verification: { hash: recordHash },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/transactions/summary
 * Get transaction summary statistics
 */
router.get('/summary', async (req, res) => {
  try {
    const { year, department, project_id } = req.query;

    let query = `
      SELECT 
        t.transaction_type,
        COUNT(*) as count,
        SUM(ABS(t.amount)) as total_amount,
        AVG(ABS(t.amount)) as avg_amount,
        MIN(ABS(t.amount)) as min_amount,
        MAX(ABS(t.amount)) as max_amount
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (year) {
      paramCount++;
      query += ` AND b.year = $${paramCount}`;
      queryParams.push(year);
    }

    if (department) {
      paramCount++;
      query += ` AND b.department ILIKE $${paramCount}`;
      queryParams.push(`%${department}%`);
    }

    if (project_id) {
      paramCount++;
      query += ` AND t.project_id = $${paramCount}`;
      queryParams.push(project_id);
    }

    query += ` GROUP BY t.transaction_type ORDER BY total_amount DESC`;

    const result = await pool.query(query, queryParams);

    // Get monthly trends
    const trendsQuery = `
      SELECT 
        DATE_TRUNC('month', t.transaction_date) as month,
        COUNT(*) as transaction_count,
        SUM(ABS(t.amount)) as total_amount
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      WHERE t.transaction_date >= NOW() - INTERVAL '12 months'
      ${year ? `AND b.year = ${year}` : ''}
      ${department ? `AND b.department ILIKE '%${department}%'` : ''}
      GROUP BY DATE_TRUNC('month', t.transaction_date)
      ORDER BY month DESC
      LIMIT 12
    `;

    const trendsResult = await pool.query(trendsQuery);

    res.json({
      byType: result.rows,
      monthlyTrends: trendsResult.rows,
      generatedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Error fetching transaction summary:', error);
    res.status(500).json({ error: 'Failed to fetch transaction summary' });
  }
});

module.exports = router;
