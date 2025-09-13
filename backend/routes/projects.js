const express = require('express');
const { pool } = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Validation schemas
const projectSchema = Joi.object({
  budget_id: Joi.string().uuid().required(),
  project_name: Joi.string().required().max(255),
  allocated_amount: Joi.number().positive().required(),
  description: Joi.string().allow('').max(1000),
  start_date: Joi.date().allow(null),
  end_date: Joi.date().allow(null),
});

/**
 * GET /api/projects
 * Get all projects with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { 
      budget_id, 
      verification_status, 
      page = 1, 
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    let query = `
      SELECT 
        p.*,
        b.department,
        b.year,
        COUNT(t.id) as transaction_count,
        COUNT(DISTINCT pv.vendor_id) as vendor_count,
        COALESCE(SUM(t.amount), 0) as total_spent
      FROM projects p
      JOIN budgets b ON p.budget_id = b.id
      LEFT JOIN transactions t ON p.id = t.project_id
      LEFT JOIN project_vendors pv ON p.id = pv.project_id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (budget_id) {
      paramCount++;
      query += ` AND p.budget_id = $${paramCount}`;
      queryParams.push(budget_id);
    }

    if (verification_status) {
      paramCount++;
      query += ` AND p.verification_status = $${paramCount}`;
      queryParams.push(verification_status);
    }

    query += ` GROUP BY p.id, b.department, b.year`;

    // Add sorting
    const validSortFields = ['project_name', 'allocated_amount', 'spent_amount', 'created_at'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY p.${sortField} ${sortDirection}`;

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
      projects: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(result.rows.length / limit),
        hasNext: result.rows.length === parseInt(limit),
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * GET /api/projects/:id
 * Get a specific project by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const projectQuery = `
      SELECT 
        p.*,
        b.department,
        b.year,
        b.total_amount as budget_total
      FROM projects p
      JOIN budgets b ON p.budget_id = b.id
      WHERE p.id = $1
    `;

    const result = await pool.query(projectQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = result.rows[0];

    // Get transactions
    const transactionsQuery = `
      SELECT t.*, v.vendor_name
      FROM transactions t
      LEFT JOIN vendors v ON t.vendor_id = v.id
      WHERE t.project_id = $1
      ORDER BY t.transaction_date DESC
    `;

    const transactionsResult = await pool.query(transactionsQuery, [id]);

    // Get vendors
    const vendorsQuery = `
      SELECT pv.*, v.vendor_name, v.contact_email
      FROM project_vendors pv
      JOIN vendors v ON pv.vendor_id = v.id
      WHERE pv.project_id = $1
    `;

    const vendorsResult = await pool.query(vendorsQuery, [id]);

    // Get approvals
    const approvalsQuery = `
      SELECT * FROM approvals 
      WHERE related_record_id = $1 AND related_record_type = 'project'
      ORDER BY signed_at DESC
    `;

    const approvalsResult = await pool.query(approvalsQuery, [id]);

    res.json({
      project,
      transactions: transactionsResult.rows,
      vendors: vendorsResult.rows,
      approvals: approvalsResult.rows,
      verification: cryptoUtils.generateVerificationQR(id, 'project'),
    });

  } catch (error) {
    logger.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { error, value } = projectSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const projectData = value;

    // Verify budget exists
    const budgetCheck = await client.query('SELECT * FROM budgets WHERE id = $1', [projectData.budget_id]);
    if (budgetCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Budget not found' });
    }

    // Generate hash
    const canonicalJson = cryptoUtils.createCanonicalJson(projectData);
    const recordHash = cryptoUtils.generateHash(projectData);

    const insertQuery = `
      INSERT INTO projects (budget_id, project_name, allocated_amount, description, start_date, end_date, record_hash, canonical_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      projectData.budget_id,
      projectData.project_name,
      projectData.allocated_amount,
      projectData.description || null,
      projectData.start_date || null,
      projectData.end_date || null,
      recordHash,
      canonicalJson,
    ]);

    await client.query('COMMIT');

    logger.info(`New project created: ${result.rows[0].id} - ${result.rows[0].project_name}`);

    res.status(201).json({
      project: result.rows[0],
      verification: { hash: recordHash },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  } finally {
    client.release();
  }
});

module.exports = router;
