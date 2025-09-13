-- Transparency Web Application Database Schema
-- PostgreSQL Database Schema with Tamper-Proof Features

-- Create database (run separately)
-- CREATE DATABASE transparency_db;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types for status tracking
CREATE TYPE verification_status AS ENUM ('verified', 'pending', 'suspicious');
CREATE TYPE record_type AS ENUM ('budget', 'project', 'vendor', 'transaction', 'approval');

-- Budgets table - Top level financial allocations
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department VARCHAR(255) NOT NULL,
    year INTEGER NOT NULL,
    total_amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    record_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash
    verification_status verification_status DEFAULT 'pending',
    canonical_json JSONB NOT NULL, -- Store canonical representation
    
    -- Constraints
    CONSTRAINT budgets_year_check CHECK (year >= 2000 AND year <= 2100),
    CONSTRAINT budgets_amount_check CHECK (total_amount >= 0)
);

-- Projects table - Specific initiatives under budgets
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    allocated_amount DECIMAL(15,2) NOT NULL,
    spent_amount DECIMAL(15,2) DEFAULT 0,
    description TEXT,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    record_hash VARCHAR(64) NOT NULL UNIQUE,
    verification_status verification_status DEFAULT 'pending',
    canonical_json JSONB NOT NULL,
    
    -- Constraints
    CONSTRAINT projects_amount_check CHECK (allocated_amount >= 0),
    CONSTRAINT projects_spent_check CHECK (spent_amount >= 0),
    CONSTRAINT projects_date_check CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

-- Vendors table - Companies/individuals providing services
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    address TEXT,
    tax_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    record_hash VARCHAR(64) NOT NULL UNIQUE,
    verification_status verification_status DEFAULT 'pending',
    canonical_json JSONB NOT NULL,
    
    -- Constraints
    CONSTRAINT vendors_email_check CHECK (contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' OR contact_email IS NULL)
);

-- Project Vendors junction table - Many-to-many relationship
CREATE TABLE project_vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    contract_amount DECIMAL(15,2) NOT NULL,
    contract_date DATE,
    contract_description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    record_hash VARCHAR(64) NOT NULL UNIQUE,
    verification_status verification_status DEFAULT 'pending',
    canonical_json JSONB NOT NULL,
    
    -- Constraints
    CONSTRAINT project_vendors_amount_check CHECK (contract_amount >= 0),
    CONSTRAINT project_vendors_unique UNIQUE (project_id, vendor_id)
);

-- Transactions table - Individual payments and expenses
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    transaction_type VARCHAR(100) NOT NULL, -- 'payment', 'expense', 'refund', etc.
    amount DECIMAL(15,2) NOT NULL,
    transaction_date DATE NOT NULL,
    description TEXT,
    document_url VARCHAR(500), -- S3/IPFS URL for receipts/invoices
    document_hash VARCHAR(64), -- Hash of the document for integrity
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    record_hash VARCHAR(64) NOT NULL UNIQUE,
    verification_status verification_status DEFAULT 'pending',
    canonical_json JSONB NOT NULL,
    
    -- Constraints
    CONSTRAINT transactions_amount_check CHECK (amount != 0),
    CONSTRAINT transactions_type_check CHECK (transaction_type IN ('payment', 'expense', 'refund', 'adjustment'))
);

-- Approvals table - Digital signatures and approvals
CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    approver_name VARCHAR(255) NOT NULL,
    approver_role VARCHAR(100) NOT NULL,
    approver_email VARCHAR(255),
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    signature TEXT NOT NULL, -- Base64 encoded digital signature
    public_key TEXT NOT NULL, -- Public key for verification
    related_record_id UUID NOT NULL,
    related_record_type record_type NOT NULL,
    approval_status VARCHAR(50) DEFAULT 'approved',
    comments TEXT,
    
    -- Constraints
    CONSTRAINT approvals_email_check CHECK (approver_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' OR approver_email IS NULL),
    CONSTRAINT approvals_status_check CHECK (approval_status IN ('approved', 'rejected', 'pending'))
);

-- Audit Log table - Track all changes for transparency
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    old_values JSONB,
    new_values JSONB,
    changed_by VARCHAR(255),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

-- Subscriptions table - Email alerts and notifications
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    subscription_type VARCHAR(100) NOT NULL, -- 'budget', 'project', 'vendor', 'transaction'
    filter_criteria JSONB, -- JSON object with filter parameters
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_notification_sent TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT subscriptions_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT subscriptions_type_check CHECK (subscription_type IN ('budget', 'project', 'vendor', 'transaction', 'all'))
);

-- Create indexes for better performance
CREATE INDEX idx_budgets_year ON budgets(year);
CREATE INDEX idx_budgets_department ON budgets(department);
CREATE INDEX idx_budgets_verification_status ON budgets(verification_status);
CREATE INDEX idx_budgets_record_hash ON budgets(record_hash);

CREATE INDEX idx_projects_budget_id ON projects(budget_id);
CREATE INDEX idx_projects_verification_status ON projects(verification_status);
CREATE INDEX idx_projects_record_hash ON projects(record_hash);

CREATE INDEX idx_vendors_name ON vendors(vendor_name);
CREATE INDEX idx_vendors_verification_status ON vendors(verification_status);
CREATE INDEX idx_vendors_record_hash ON vendors(record_hash);

CREATE INDEX idx_project_vendors_project_id ON project_vendors(project_id);
CREATE INDEX idx_project_vendors_vendor_id ON project_vendors(vendor_id);
CREATE INDEX idx_project_vendors_record_hash ON project_vendors(record_hash);

CREATE INDEX idx_transactions_project_id ON transactions(project_id);
CREATE INDEX idx_transactions_vendor_id ON transactions(vendor_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_verification_status ON transactions(verification_status);
CREATE INDEX idx_transactions_record_hash ON transactions(record_hash);

CREATE INDEX idx_approvals_record_id ON approvals(related_record_id);
CREATE INDEX idx_approvals_record_type ON approvals(related_record_type);
CREATE INDEX idx_approvals_signed_at ON approvals(signed_at);

CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_changed_at ON audit_log(changed_at);

CREATE INDEX idx_subscriptions_email ON subscriptions(email);
CREATE INDEX idx_subscriptions_type ON subscriptions(subscription_type);
CREATE INDEX idx_subscriptions_active ON subscriptions(is_active);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_budgets_updated_at BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function for audit logging
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, record_id, action, new_values)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_values, new_values)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_values)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create audit triggers for all main tables
CREATE TRIGGER audit_budgets AFTER INSERT OR UPDATE OR DELETE ON budgets
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE OR DELETE ON projects
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON vendors
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_project_vendors AFTER INSERT OR UPDATE OR DELETE ON project_vendors
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create views for common queries
CREATE VIEW budget_summary AS
SELECT 
    b.id,
    b.department,
    b.year,
    b.total_amount,
    b.verification_status,
    COUNT(p.id) as project_count,
    COALESCE(SUM(p.allocated_amount), 0) as allocated_amount,
    COALESCE(SUM(p.spent_amount), 0) as spent_amount,
    (b.total_amount - COALESCE(SUM(p.allocated_amount), 0)) as remaining_amount
FROM budgets b
LEFT JOIN projects p ON b.id = p.budget_id
GROUP BY b.id, b.department, b.year, b.total_amount, b.verification_status;

CREATE VIEW project_summary AS
SELECT 
    p.id,
    p.project_name,
    p.allocated_amount,
    p.spent_amount,
    p.verification_status,
    b.department,
    b.year,
    COUNT(t.id) as transaction_count,
    COUNT(DISTINCT pv.vendor_id) as vendor_count
FROM projects p
JOIN budgets b ON p.budget_id = b.id
LEFT JOIN transactions t ON p.id = t.project_id
LEFT JOIN project_vendors pv ON p.id = pv.project_id
GROUP BY p.id, p.project_name, p.allocated_amount, p.spent_amount, p.verification_status, b.department, b.year;

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO transparency_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO transparency_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO transparency_user;
