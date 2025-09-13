const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { pool } = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const budgetRoutes = require('./routes/budgets');
const projectRoutes = require('./routes/projects');
const vendorRoutes = require('./routes/vendors');
const transactionRoutes = require('./routes/transactions');
const verificationRoutes = require('./routes/verification');
const subscriptionRoutes = require('./routes/subscriptions');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime(),
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message,
    });
  }
});

// API routes
app.use('/api/budgets', budgetRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/verify', verificationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/upload', uploadRoutes);

// Dashboard summary endpoint
app.get('/api/dashboard', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    
    // Get budget summary
    const budgetSummary = await pool.query(`
      SELECT 
        department,
        SUM(total_amount) as total_budget,
        COUNT(*) as budget_count,
        SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_count
      FROM budgets 
      WHERE year = $1 
      GROUP BY department
      ORDER BY total_budget DESC
    `, [year]);

    // Get project summary
    const projectSummary = await pool.query(`
      SELECT 
        COUNT(*) as total_projects,
        SUM(allocated_amount) as total_allocated,
        SUM(spent_amount) as total_spent,
        SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_projects
      FROM projects p
      JOIN budgets b ON p.budget_id = b.id
      WHERE b.year = $1
    `, [year]);

    // Get recent transactions
    const recentTransactions = await pool.query(`
      SELECT 
        t.id,
        t.amount,
        t.transaction_date,
        t.description,
        t.verification_status,
        p.project_name,
        v.vendor_name,
        b.department
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      LEFT JOIN vendors v ON t.vendor_id = v.id
      WHERE b.year = $1
      ORDER BY t.transaction_date DESC
      LIMIT 10
    `, [year]);

    // Get verification statistics
    const verificationStats = await pool.query(`
      SELECT 
        'budgets' as record_type,
        verification_status,
        COUNT(*) as count
      FROM budgets WHERE year = $1
      GROUP BY verification_status
      UNION ALL
      SELECT 
        'projects' as record_type,
        verification_status,
        COUNT(*) as count
      FROM projects p
      JOIN budgets b ON p.budget_id = b.id
      WHERE b.year = $1
      GROUP BY verification_status
      UNION ALL
      SELECT 
        'transactions' as record_type,
        verification_status,
        COUNT(*) as count
      FROM transactions t
      JOIN projects p ON t.project_id = p.id
      JOIN budgets b ON p.budget_id = b.id
      WHERE b.year = $1
      GROUP BY verification_status
    `, [year]);

    res.json({
      year: parseInt(year),
      budgetSummary: budgetSummary.rows,
      projectSummary: projectSummary.rows[0] || {},
      recentTransactions: recentTransactions.rows,
      verificationStats: verificationStats.rows,
      generatedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Dashboard endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { q, type, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTerm = `%${q.trim()}%`;
    const results = [];

    // Search budgets
    if (!type || type === 'budgets') {
      const budgets = await pool.query(`
        SELECT 
          'budget' as type,
          id,
          department as title,
          CONCAT(year, ' - $', total_amount::text) as subtitle,
          verification_status,
          year
        FROM budgets 
        WHERE department ILIKE $1 OR description ILIKE $1
        ORDER BY year DESC, total_amount DESC
        LIMIT $2
      `, [searchTerm, limit]);
      results.push(...budgets.rows);
    }

    // Search projects
    if (!type || type === 'projects') {
      const projects = await pool.query(`
        SELECT 
          'project' as type,
          p.id,
          p.project_name as title,
          CONCAT(b.department, ' - $', p.allocated_amount::text) as subtitle,
          p.verification_status,
          b.year
        FROM projects p
        JOIN budgets b ON p.budget_id = b.id
        WHERE p.project_name ILIKE $1 OR p.description ILIKE $1
        ORDER BY b.year DESC, p.allocated_amount DESC
        LIMIT $2
      `, [searchTerm, limit]);
      results.push(...projects.rows);
    }

    // Search vendors
    if (!type || type === 'vendors') {
      const vendors = await pool.query(`
        SELECT 
          'vendor' as type,
          id,
          vendor_name as title,
          COALESCE(address, 'No address provided') as subtitle,
          verification_status,
          NULL as year
        FROM vendors 
        WHERE vendor_name ILIKE $1 OR address ILIKE $1
        ORDER BY vendor_name
        LIMIT $2
      `, [searchTerm, limit]);
      results.push(...vendors.rows);
    }

    // Search transactions
    if (!type || type === 'transactions') {
      const transactions = await pool.query(`
        SELECT 
          'transaction' as type,
          t.id,
          CONCAT('$', t.amount::text, ' - ', t.description) as title,
          CONCAT(p.project_name, ' (', t.transaction_date, ')') as subtitle,
          t.verification_status,
          b.year
        FROM transactions t
        JOIN projects p ON t.project_id = p.id
        JOIN budgets b ON p.budget_id = b.id
        WHERE t.description ILIKE $1
        ORDER BY t.transaction_date DESC, t.amount DESC
        LIMIT $2
      `, [searchTerm, limit]);
      results.push(...transactions.rows);
    }

    // Sort results by relevance and verification status
    results.sort((a, b) => {
      if (a.verification_status === 'verified' && b.verification_status !== 'verified') return -1;
      if (b.verification_status === 'verified' && a.verification_status !== 'verified') return 1;
      return 0;
    });

    res.json({
      query: q,
      results: results.slice(0, limit),
      totalFound: results.length,
    });

  } catch (error) {
    logger.error('Search endpoint error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await pool.end();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info(`Transparency API server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});

module.exports = app;
