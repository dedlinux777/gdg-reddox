const express = require('express');
const { pool } = require('../config/database');
const cryptoUtils = require('../utils/crypto');
const logger = require('../utils/logger');
const Joi = require('joi');

const router = express.Router();

// Validation schemas
const budgetSchema = Joi.object({
  department: Joi.string().required().max(255),
  year: Joi.number().integer().min(2000).max(2100).required(),
  total_amount: Joi.number().positive().required(),
  description: Joi.string().allow('').max(1000),
});

const updateBudgetSchema = Joi.object({
  department: Joi.string().max(255),
  year: Joi.number().integer().min(2000).max(2100),
  total_amount: Joi.number().positive(),
  description: Joi.string().allow('').max(1000),
});

/**
 * GET /api/budgets
 * Get all budgets with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const { 
      year, 
      department, 
      verification_status, 
      page = 1, 
      limit = 20,
      sort_by = 'year',
      sort_order = 'DESC'
    } = req.query;

    let query = `
      SELECT 
        b.*,
        COUNT(p.id) as project_count,
        COALESCE(SUM(p.allocated_amount), 0) as allocated_amount,
        COALESCE(SUM(p.spent_amount), 0) as spent_amount
      FROM budgets b
      LEFT JOIN projects p ON b.id = p.budget_id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    // Add filters
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

    if (verification_status) {
      paramCount++;
      query += ` AND b.verification_status = $${paramCount}`;
      queryParams.push(verification_status);
    }

    query += ` GROUP BY b.id`;

    // Add sorting
    const validSortFields = ['year', 'department', 'total_amount', 'created_at'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'year';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY b.${sortField} ${sortDirection}`;

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
    let countQuery = 'SELECT COUNT(*) FROM budgets WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (year) {
      countParamCount++;
      countQuery += ` AND year = $${countParamCount}`;
      countParams.push(year);
    }

    if (department) {
      countParamCount++;
      countQuery += ` AND department ILIKE $${countParamCount}`;
      countParams.push(`%${department}%`);
    }

    if (verification_status) {
      countParamCount++;
      countQuery += ` AND verification_status = $${countParamCount}`;
      countParams.push(verification_status);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      budgets: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasNext: page * limit < totalCount,
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

/**
 * GET /api/budgets/:id
 * Get a specific budget by ID with related data
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get budget details
    const budgetQuery = `
      SELECT 
        b.*,
        COUNT(p.id) as project_count,
        COALESCE(SUM(p.allocated_amount), 0) as allocated_amount,
        COALESCE(SUM(p.spent_amount), 0) as spent_amount
      FROM budgets b
      LEFT JOIN projects p ON b.id = p.budget_id
      WHERE b.id = $1
      GROUP BY b.id
    `;

    const budgetResult = await pool.query(budgetQuery, [id]);

    if (budgetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const budget = budgetResult.rows[0];

    // Get related projects
    const projectsQuery = `
      SELECT 
        p.*,
        COUNT(t.id) as transaction_count,
        COUNT(DISTINCT pv.vendor_id) as vendor_count
      FROM projects p
      LEFT JOIN transactions t ON p.id = t.project_id
      LEFT JOIN project_vendors pv ON p.id = pv.project_id
      WHERE p.budget_id = $1
      GROUP BY p.id
      ORDER BY p.allocated_amount DESC
    `;

    const projectsResult = await pool.query(projectsQuery, [id]);

    // Get approvals/signatures
    const approvalsQuery = `
      SELECT * FROM approvals 
      WHERE related_record_id = $1 AND related_record_type = 'budget'
      ORDER BY signed_at DESC
    `;

    const approvalsResult = await pool.query(approvalsQuery, [id]);

    // Generate verification QR code
    const qrData = cryptoUtils.generateVerificationQR(id, 'budget');

    res.json({
      budget,
      projects: projectsResult.rows,
      approvals: approvalsResult.rows,
      verification: {
        qrCode: qrData,
        verificationUrl: qrData.url,
      },
    });

  } catch (error) {
    logger.error('Error fetching budget:', error);
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

/**
 * POST /api/budgets
 * Create a new budget with tamper-proof verification
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate input
    const { error, value } = budgetSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const budgetData = value;

    // Generate canonical JSON and hash
    const canonicalJson = cryptoUtils.createCanonicalJson(budgetData);
    const recordHash = cryptoUtils.generateHash(budgetData);

    // Insert budget
    const insertQuery = `
      INSERT INTO budgets (department, year, total_amount, description, record_hash, canonical_json, verification_status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      budgetData.department,
      budgetData.year,
      budgetData.total_amount,
      budgetData.description || null,
      recordHash,
      canonicalJson,
    ]);

    const newBudget = result.rows[0];

    // Create digital signature
    const signatureData = cryptoUtils.signRecord(newBudget, {
      name: 'System Administrator',
      role: 'System',
      email: 'admin@transparency.gov',
    });

    // Insert approval record
    const approvalQuery = `
      INSERT INTO approvals (approver_name, approver_role, approver_email, signature, public_key, related_record_id, related_record_type)
      VALUES ($1, $2, $3, $4, $5, $6, 'budget')
      RETURNING *
    `;

    const approvalResult = await client.query(approvalQuery, [
      signatureData.signerInfo.name,
      signatureData.signerInfo.role,
      signatureData.signerInfo.email,
      signatureData.signature,
      signatureData.publicKey,
      newBudget.id,
    ]);

    await client.query('COMMIT');

    logger.info(`New budget created: ${newBudget.id} - ${newBudget.department} ${newBudget.year}`);

    res.status(201).json({
      budget: newBudget,
      approval: approvalResult.rows[0],
      verification: {
        hash: recordHash,
        signature: signatureData,
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating budget:', error);
    res.status(500).json({ error: 'Failed to create budget' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/budgets/:id
 * Update a budget and regenerate verification
 */
router.put('/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Validate input
    const { error, value } = updateBudgetSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    // Check if budget exists
    const existingResult = await client.query('SELECT * FROM budgets WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const existingBudget = existingResult.rows[0];
    const updatedData = { ...existingBudget, ...value };

    // Generate new hash
    const canonicalJson = cryptoUtils.createCanonicalJson(updatedData);
    const recordHash = cryptoUtils.generateHash(updatedData);

    // Update budget
    const updateFields = [];
    const updateValues = [];
    let paramCount = 0;

    Object.keys(value).forEach(key => {
      paramCount++;
      updateFields.push(`${key} = $${paramCount}`);
      updateValues.push(value[key]);
    });

    paramCount++;
    updateFields.push(`record_hash = $${paramCount}`);
    updateValues.push(recordHash);

    paramCount++;
    updateFields.push(`canonical_json = $${paramCount}`);
    updateValues.push(canonicalJson);

    paramCount++;
    updateFields.push(`verification_status = $${paramCount}`);
    updateValues.push('pending');

    paramCount++;
    updateFields.push(`updated_at = $${paramCount}`);
    updateValues.push(new Date());

    paramCount++;
    updateValues.push(id);

    const updateQuery = `
      UPDATE budgets 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await client.query(updateQuery, updateValues);
    const updatedBudget = result.rows[0];

    await client.query('COMMIT');

    logger.info(`Budget updated: ${id}`);

    res.json({
      budget: updatedBudget,
      verification: {
        hash: recordHash,
        status: 'pending_verification',
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error updating budget:', error);
    res.status(500).json({ error: 'Failed to update budget' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/budgets/:id
 * Delete a budget (soft delete by marking as inactive)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if budget has related projects
    const projectsResult = await pool.query('SELECT COUNT(*) FROM projects WHERE budget_id = $1', [id]);
    const projectCount = parseInt(projectsResult.rows[0].count);

    if (projectCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete budget with ${projectCount} related projects. Delete projects first.` 
      });
    }

    // Delete budget
    const result = await pool.query('DELETE FROM budgets WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    logger.info(`Budget deleted: ${id}`);

    res.json({ 
      message: 'Budget deleted successfully',
      deletedBudget: result.rows[0] 
    });

  } catch (error) {
    logger.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

/**
 * GET /api/budgets/:id/summary
 * Get budget summary with charts data
 */
router.get('/:id/summary', async (req, res) => {
  try {
    const { id } = req.params;

    // Get budget with project breakdown
    const summaryQuery = `
      SELECT 
        b.department,
        b.year,
        b.total_amount,
        b.verification_status,
        json_agg(
          json_build_object(
            'project_name', p.project_name,
            'allocated_amount', p.allocated_amount,
            'spent_amount', p.spent_amount,
            'verification_status', p.verification_status
          )
        ) FILTER (WHERE p.id IS NOT NULL) as projects
      FROM budgets b
      LEFT JOIN projects p ON b.id = p.budget_id
      WHERE b.id = $1
      GROUP BY b.id, b.department, b.year, b.total_amount, b.verification_status
    `;

    const result = await pool.query(summaryQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const budget = result.rows[0];

    // Prepare chart data
    const chartData = {
      pieChart: {
        labels: budget.projects?.map(p => p.project_name) || [],
        datasets: [{
          data: budget.projects?.map(p => parseFloat(p.allocated_amount)) || [],
          backgroundColor: [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
            '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
          ],
        }],
      },
      barChart: {
        labels: budget.projects?.map(p => p.project_name) || [],
        datasets: [
          {
            label: 'Allocated',
            data: budget.projects?.map(p => parseFloat(p.allocated_amount)) || [],
            backgroundColor: '#36A2EB',
          },
          {
            label: 'Spent',
            data: budget.projects?.map(p => parseFloat(p.spent_amount)) || [],
            backgroundColor: '#FF6384',
          },
        ],
      },
    };

    res.json({
      budget,
      chartData,
      summary: {
        totalAllocated: budget.projects?.reduce((sum, p) => sum + parseFloat(p.allocated_amount || 0), 0) || 0,
        totalSpent: budget.projects?.reduce((sum, p) => sum + parseFloat(p.spent_amount || 0), 0) || 0,
        projectCount: budget.projects?.length || 0,
        verifiedProjects: budget.projects?.filter(p => p.verification_status === 'verified').length || 0,
      },
    });

  } catch (error) {
    logger.error('Error fetching budget summary:', error);
    res.status(500).json({ error: 'Failed to fetch budget summary' });
  }
});

module.exports = router;
