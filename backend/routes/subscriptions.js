const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const nodemailer = require('nodemailer');

const router = express.Router();

// Email transporter configuration
const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Validation schema
const subscriptionSchema = Joi.object({
  email: Joi.string().email().required(),
  subscription_type: Joi.string().valid('budget', 'project', 'vendor', 'transaction', 'all').required(),
  filter_criteria: Joi.object().default({}),
});

/**
 * GET /api/subscriptions
 * Get all active subscriptions (admin only)
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, email, subscription_type } = req.query;

    let query = 'SELECT * FROM subscriptions WHERE is_active = true';
    const queryParams = [];
    let paramCount = 0;

    if (email) {
      paramCount++;
      query += ` AND email ILIKE $${paramCount}`;
      queryParams.push(`%${email}%`);
    }

    if (subscription_type) {
      paramCount++;
      query += ` AND subscription_type = $${paramCount}`;
      queryParams.push(subscription_type);
    }

    query += ' ORDER BY created_at DESC';

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
      subscriptions: result.rows,
      pagination: {
        currentPage: parseInt(page),
        hasNext: result.rows.length === parseInt(limit),
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

/**
 * POST /api/subscriptions
 * Create a new subscription
 */
router.post('/', async (req, res) => {
  try {
    const { error, value } = subscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, subscription_type, filter_criteria } = value;

    // Check if subscription already exists
    const existingQuery = `
      SELECT * FROM subscriptions 
      WHERE email = $1 AND subscription_type = $2 AND is_active = true
    `;
    const existingResult = await pool.query(existingQuery, [email, subscription_type]);

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Subscription already exists for this email and type' });
    }

    // Create new subscription
    const insertQuery = `
      INSERT INTO subscriptions (email, subscription_type, filter_criteria)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [email, subscription_type, JSON.stringify(filter_criteria)]);

    // Send confirmation email
    await sendConfirmationEmail(email, subscription_type, filter_criteria);

    logger.info(`New subscription created: ${email} - ${subscription_type}`);

    res.status(201).json({
      subscription: result.rows[0],
      message: 'Subscription created successfully. Confirmation email sent.',
    });

  } catch (error) {
    logger.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

/**
 * DELETE /api/subscriptions/:id
 * Unsubscribe (deactivate subscription)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE subscriptions 
      SET is_active = false 
      WHERE id = $1 
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    logger.info(`Subscription deactivated: ${id}`);

    res.json({
      message: 'Successfully unsubscribed',
      subscription: result.rows[0],
    });

  } catch (error) {
    logger.error('Error unsubscribing:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

/**
 * POST /api/subscriptions/notify
 * Send notifications to subscribers (internal use)
 */
router.post('/notify', async (req, res) => {
  try {
    const { record_type, record_id, action = 'created' } = req.body;

    if (!record_type || !record_id) {
      return res.status(400).json({ error: 'record_type and record_id are required' });
    }

    // Get relevant subscriptions
    const subscriptionsQuery = `
      SELECT * FROM subscriptions 
      WHERE is_active = true 
      AND (subscription_type = $1 OR subscription_type = 'all')
    `;

    const subscriptionsResult = await pool.query(subscriptionsQuery, [record_type]);
    const subscriptions = subscriptionsResult.rows;

    if (subscriptions.length === 0) {
      return res.json({ message: 'No active subscriptions found', notificationsSent: 0 });
    }

    // Get record details
    const tableMap = {
      budget: 'budgets',
      project: 'projects',
      vendor: 'vendors',
      transaction: 'transactions',
    };

    const tableName = tableMap[record_type];
    const recordQuery = `SELECT * FROM ${tableName} WHERE id = $1`;
    const recordResult = await pool.query(recordQuery, [record_id]);

    if (recordResult.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const record = recordResult.rows[0];
    let notificationsSent = 0;

    // Send notifications
    for (const subscription of subscriptions) {
      try {
        // Check if record matches filter criteria
        if (matchesFilterCriteria(record, subscription.filter_criteria)) {
          await sendNotificationEmail(subscription.email, record_type, record, action);
          
          // Update last notification sent timestamp
          await pool.query(`
            UPDATE subscriptions 
            SET last_notification_sent = NOW() 
            WHERE id = $1
          `, [subscription.id]);

          notificationsSent++;
        }
      } catch (emailError) {
        logger.error(`Failed to send notification to ${subscription.email}:`, emailError);
      }
    }

    logger.info(`Sent ${notificationsSent} notifications for ${record_type} ${record_id}`);

    res.json({
      message: `Notifications sent successfully`,
      notificationsSent,
      totalSubscriptions: subscriptions.length,
    });

  } catch (error) {
    logger.error('Error sending notifications:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

/**
 * Helper function to check if record matches filter criteria
 */
function matchesFilterCriteria(record, filterCriteria) {
  if (!filterCriteria || Object.keys(filterCriteria).length === 0) {
    return true; // No filter means match all
  }

  for (const [key, value] of Object.entries(filterCriteria)) {
    if (key.endsWith('_greater_than')) {
      const fieldName = key.replace('_greater_than', '');
      if (parseFloat(record[fieldName]) <= parseFloat(value)) {
        return false;
      }
    } else if (key.endsWith('_contains')) {
      const fieldName = key.replace('_contains', '');
      if (!record[fieldName] || !record[fieldName].toLowerCase().includes(value.toLowerCase())) {
        return false;
      }
    } else {
      if (record[key] !== value) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Send confirmation email for new subscription
 */
async function sendConfirmationEmail(email, subscriptionType, filterCriteria) {
  const subject = 'Transparency Portal - Subscription Confirmed';
  const html = `
    <h2>Subscription Confirmed</h2>
    <p>Thank you for subscribing to transparency updates!</p>
    <p><strong>Subscription Type:</strong> ${subscriptionType}</p>
    <p><strong>Email:</strong> ${email}</p>
    ${Object.keys(filterCriteria).length > 0 ? 
      `<p><strong>Filters:</strong> ${JSON.stringify(filterCriteria, null, 2)}</p>` : 
      '<p>You will receive all updates for this category.</p>'
    }
    <p>You will receive notifications when new records are added or updated.</p>
    <hr>
    <p><small>This is an automated message from the Government Transparency Portal.</small></p>
  `;

  await transporter.sendMail({
    from: process.env.FROM_EMAIL || 'noreply@transparency.gov',
    to: email,
    subject,
    html,
  });
}

/**
 * Send notification email for new/updated records
 */
async function sendNotificationEmail(email, recordType, record, action) {
  const subject = `Transparency Alert - New ${recordType} ${action}`;
  
  let recordTitle = '';
  let recordDetails = '';

  switch (recordType) {
    case 'budget':
      recordTitle = `${record.department} Budget ${record.year}`;
      recordDetails = `Amount: $${parseFloat(record.total_amount).toLocaleString()}`;
      break;
    case 'project':
      recordTitle = record.project_name;
      recordDetails = `Budget: $${parseFloat(record.allocated_amount).toLocaleString()}`;
      break;
    case 'vendor':
      recordTitle = record.vendor_name;
      recordDetails = record.address || 'No address provided';
      break;
    case 'transaction':
      recordTitle = `Transaction - $${parseFloat(record.amount).toLocaleString()}`;
      recordDetails = record.description || 'No description';
      break;
  }

  const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/${recordType}/${record.id}`;

  const html = `
    <h2>New ${recordType.charAt(0).toUpperCase() + recordType.slice(1)} ${action.charAt(0).toUpperCase() + action.slice(1)}</h2>
    <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px;">
      <h3>${recordTitle}</h3>
      <p>${recordDetails}</p>
      <p><strong>Verification Status:</strong> 
        <span style="color: ${record.verification_status === 'verified' ? 'green' : record.verification_status === 'pending' ? 'orange' : 'red'}">
          ${record.verification_status === 'verified' ? '✅ Verified' : record.verification_status === 'pending' ? '⚠️ Pending' : '❌ Suspicious'}
        </span>
      </p>
      <p><strong>Date:</strong> ${new Date(record.created_at).toLocaleDateString()}</p>
      <a href="${verificationUrl}" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 3px;">
        Verify Record
      </a>
    </div>
    <hr>
    <p><small>
      You are receiving this because you subscribed to ${recordType} updates. 
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe">Unsubscribe</a>
    </small></p>
  `;

  await transporter.sendMail({
    from: process.env.FROM_EMAIL || 'noreply@transparency.gov',
    to: email,
    subject,
    html,
  });
}

module.exports = router;
