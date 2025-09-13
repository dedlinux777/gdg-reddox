const express = require('express');
const { pool } = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Validation schema
const vendorSchema = Joi.object({
  vendor_name: Joi.string().required().max(255),
  contact_email: Joi.string().email().allow('').max(255),
  contact_phone: Joi.string().allow('').max(50),
  address: Joi.string().allow('').max(500),
  tax_id: Joi.string().allow('').max(100),
});

/**
 * GET /api/vendors
 * Get all vendors with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { 
      verification_status, 
      page = 1, 
      limit = 20,
      search = ''
    } = req.query;

    let query = `
      SELECT 
        v.*,
        COUNT(DISTINCT pv.project_id) as project_count,
        COUNT(DISTINCT t.id) as transaction_count,
        COALESCE(SUM(pv.contract_amount), 0) as total_contracts
      FROM vendors v
      LEFT JOIN project_vendors pv ON v.id = pv.vendor_id
      LEFT JOIN transactions t ON v.id = t.vendor_id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (verification_status) {
      paramCount++;
      query += ` AND v.verification_status = $${paramCount}`;
      queryParams.push(verification_status);
    }

    if (search) {
      paramCount++;
      query += ` AND (v.vendor_name ILIKE $${paramCount} OR v.address ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    query += ` GROUP BY v.id ORDER BY v.vendor_name`;

    // Add pagination
    const offset = (page - 1) * limit;
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limit);

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);

    res.json({
      vendors: result.rows,
      pagination: {
        currentPage: parseInt(page),
        hasNext: result.rows.length === parseInt(limit),
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

/**
 * GET /api/vendors/:id
 * Get a specific vendor by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const vendorResult = await pool.query('SELECT * FROM vendors WHERE id = $1', [id]);

    if (vendorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const vendor = vendorResult.rows[0];

    // Get vendor's projects and contracts
    const projectsQuery = `
      SELECT 
        pv.*,
        p.project_name,
        b.department,
        b.year
      FROM project_vendors pv
      JOIN projects p ON pv.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      WHERE pv.vendor_id = $1
      ORDER BY pv.contract_date DESC
    `;

    const projectsResult = await pool.query(projectsQuery, [id]);

    // Get vendor's transactions
    const transactionsQuery = `
      SELECT 
        t.*,
        p.project_name,
        b.department
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      WHERE t.vendor_id = $1
      ORDER BY t.transaction_date DESC
    `;

    const transactionsResult = await pool.query(transactionsQuery, [id]);

    res.json({
      vendor,
      projects: projectsResult.rows,
      transactions: transactionsResult.rows,
      verification: cryptoUtils.generateVerificationQR(id, 'vendor'),
    });

  } catch (error) {
    logger.error('Error fetching vendor:', error);
    res.status(500).json({ error: 'Failed to fetch vendor' });
  }
});

/**
 * POST /api/vendors
 * Create a new vendor
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { error, value } = vendorSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const vendorData = value;

    // Generate hash
    const canonicalJson = cryptoUtils.createCanonicalJson(vendorData);
    const recordHash = cryptoUtils.generateHash(vendorData);

    const insertQuery = `
      INSERT INTO vendors (vendor_name, contact_email, contact_phone, address, tax_id, record_hash, canonical_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      vendorData.vendor_name,
      vendorData.contact_email || null,
      vendorData.contact_phone || null,
      vendorData.address || null,
      vendorData.tax_id || null,
      recordHash,
      canonicalJson,
    ]);

    await client.query('COMMIT');

    logger.info(`New vendor created: ${result.rows[0].id} - ${result.rows[0].vendor_name}`);

    res.status(201).json({
      vendor: result.rows[0],
      verification: { hash: recordHash },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating vendor:', error);
    res.status(500).json({ error: 'Failed to create vendor' });
  } finally {
    client.release();
  }
});

module.exports = router;
