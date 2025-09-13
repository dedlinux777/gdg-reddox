-- Sample Data for Transparency Web Application
-- This file populates the database with realistic sample data for demonstration

-- Insert sample budgets
INSERT INTO budgets (id, department, year, total_amount, description, record_hash, verification_status, canonical_json) VALUES
(
    '550e8400-e29b-41d4-a716-446655440001',
    'Education',
    2024,
    5000000.00,
    'Annual education budget for schools, infrastructure, and teacher training',
    'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
    'verified',
    '{"id":"550e8400-e29b-41d4-a716-446655440001","department":"Education","year":2024,"total_amount":5000000.00,"description":"Annual education budget for schools, infrastructure, and teacher training"}'::jsonb
),
(
    '550e8400-e29b-41d4-a716-446655440002',
    'Healthcare',
    2024,
    8000000.00,
    'Healthcare budget for hospitals, medical equipment, and staff salaries',
    'b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567',
    'verified',
    '{"id":"550e8400-e29b-41d4-a716-446655440002","department":"Healthcare","year":2024,"total_amount":8000000.00,"description":"Healthcare budget for hospitals, medical equipment, and staff salaries"}'::jsonb
),
(
    '550e8400-e29b-41d4-a716-446655440003',
    'Infrastructure',
    2024,
    12000000.00,
    'Infrastructure development including roads, bridges, and public facilities',
    'c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678',
    'pending',
    '{"id":"550e8400-e29b-41d4-a716-446655440003","department":"Infrastructure","year":2024,"total_amount":12000000.00,"description":"Infrastructure development including roads, bridges, and public facilities"}'::jsonb
);

-- Insert sample projects
INSERT INTO projects (id, budget_id, project_name, allocated_amount, spent_amount, description, start_date, end_date, record_hash, verification_status, canonical_json) VALUES
(
    '660e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440001',
    'New School Construction',
    2000000.00,
    1500000.00,
    'Construction of 3 new primary schools in rural areas',
    '2024-01-15',
    '2024-12-31',
    'd4e5f6789012345678901234567890abcdef1234567890abcdef123456789',
    'verified',
    '{"id":"660e8400-e29b-41d4-a716-446655440001","budget_id":"550e8400-e29b-41d4-a716-446655440001","project_name":"New School Construction","allocated_amount":2000000.00,"spent_amount":1500000.00,"description":"Construction of 3 new primary schools in rural areas","start_date":"2024-01-15","end_date":"2024-12-31"}'::jsonb
),
(
    '660e8400-e29b-41d4-a716-446655440002',
    '550e8400-e29b-41d4-a716-446655440001',
    'Teacher Training Program',
    1500000.00,
    800000.00,
    'Professional development and certification program for 500 teachers',
    '2024-03-01',
    '2024-11-30',
    'e5f6789012345678901234567890abcdef1234567890abcdef1234567890',
    'verified',
    '{"id":"660e8400-e29b-41d4-a716-446655440002","budget_id":"550e8400-e29b-41d4-a716-446655440001","project_name":"Teacher Training Program","allocated_amount":1500000.00,"spent_amount":800000.00,"description":"Professional development and certification program for 500 teachers","start_date":"2024-03-01","end_date":"2024-11-30"}'::jsonb
),
(
    '660e8400-e29b-41d4-a716-446655440003',
    '550e8400-e29b-41d4-a716-446655440002',
    'Hospital Equipment Upgrade',
    3000000.00,
    2200000.00,
    'Purchase and installation of modern medical equipment for regional hospital',
    '2024-02-01',
    '2024-08-31',
    'f6789012345678901234567890abcdef1234567890abcdef12345678901',
    'verified',
    '{"id":"660e8400-e29b-41d4-a716-446655440003","budget_id":"550e8400-e29b-41d4-a716-446655440002","project_name":"Hospital Equipment Upgrade","allocated_amount":3000000.00,"spent_amount":2200000.00,"description":"Purchase and installation of modern medical equipment for regional hospital","start_date":"2024-02-01","end_date":"2024-08-31"}'::jsonb
),
(
    '660e8400-e29b-41d4-a716-446655440004',
    '550e8400-e29b-41d4-a716-446655440003',
    'Highway Expansion Project',
    8000000.00,
    3500000.00,
    'Expansion of main highway connecting major cities',
    '2024-04-01',
    '2025-03-31',
    '789012345678901234567890abcdef1234567890abcdef123456789012',
    'pending',
    '{"id":"660e8400-e29b-41d4-a716-446655440004","budget_id":"550e8400-e29b-41d4-a716-446655440003","project_name":"Highway Expansion Project","allocated_amount":8000000.00,"spent_amount":3500000.00,"description":"Expansion of main highway connecting major cities","start_date":"2024-04-01","end_date":"2025-03-31"}'::jsonb
);

-- Insert sample vendors
INSERT INTO vendors (id, vendor_name, contact_email, contact_phone, address, tax_id, record_hash, verification_status, canonical_json) VALUES
(
    '770e8400-e29b-41d4-a716-446655440001',
    'BuildRight Construction Co.',
    'contact@buildright.com',
    '+1-555-0101',
    '123 Construction Ave, Builder City, BC 12345',
    'TAX123456789',
    '89012345678901234567890abcdef1234567890abcdef1234567890123',
    'verified',
    '{"id":"770e8400-e29b-41d4-a716-446655440001","vendor_name":"BuildRight Construction Co.","contact_email":"contact@buildright.com","contact_phone":"+1-555-0101","address":"123 Construction Ave, Builder City, BC 12345","tax_id":"TAX123456789"}'::jsonb
),
(
    '770e8400-e29b-41d4-a716-446655440002',
    'EduTech Solutions Ltd.',
    'info@edutech.com',
    '+1-555-0202',
    '456 Education Blvd, Learning Town, LT 67890',
    'TAX987654321',
    '9012345678901234567890abcdef1234567890abcdef12345678901234',
    'verified',
    '{"id":"770e8400-e29b-41d4-a716-446655440002","vendor_name":"EduTech Solutions Ltd.","contact_email":"info@edutech.com","contact_phone":"+1-555-0202","address":"456 Education Blvd, Learning Town, LT 67890","tax_id":"TAX987654321"}'::jsonb
),
(
    '770e8400-e29b-41d4-a716-446655440003',
    'MedEquip International',
    'sales@medequip.com',
    '+1-555-0303',
    '789 Medical Plaza, Health City, HC 13579',
    'TAX456789123',
    '012345678901234567890abcdef1234567890abcdef123456789012345',
    'verified',
    '{"id":"770e8400-e29b-41d4-a716-446655440003","vendor_name":"MedEquip International","contact_email":"sales@medequip.com","contact_phone":"+1-555-0303","address":"789 Medical Plaza, Health City, HC 13579","tax_id":"TAX456789123"}'::jsonb
),
(
    '770e8400-e29b-41d4-a716-446655440004',
    'Highway Masters Inc.',
    'projects@highwaymasters.com',
    '+1-555-0404',
    '321 Infrastructure Way, Road City, RC 24680',
    'TAX789123456',
    '12345678901234567890abcdef1234567890abcdef1234567890123456',
    'pending',
    '{"id":"770e8400-e29b-41d4-a716-446655440004","vendor_name":"Highway Masters Inc.","contact_email":"projects@highwaymasters.com","contact_phone":"+1-555-0404","address":"321 Infrastructure Way, Road City, RC 24680","tax_id":"TAX789123456"}'::jsonb
);

-- Insert project-vendor relationships
INSERT INTO project_vendors (id, project_id, vendor_id, contract_amount, contract_date, contract_description, record_hash, verification_status, canonical_json) VALUES
(
    '880e8400-e29b-41d4-a716-446655440001',
    '660e8400-e29b-41d4-a716-446655440001',
    '770e8400-e29b-41d4-a716-446655440001',
    2000000.00,
    '2024-01-10',
    'Construction contract for 3 primary schools including materials and labor',
    '2345678901234567890abcdef1234567890abcdef12345678901234567',
    'verified',
    '{"id":"880e8400-e29b-41d4-a716-446655440001","project_id":"660e8400-e29b-41d4-a716-446655440001","vendor_id":"770e8400-e29b-41d4-a716-446655440001","contract_amount":2000000.00,"contract_date":"2024-01-10","contract_description":"Construction contract for 3 primary schools including materials and labor"}'::jsonb
),
(
    '880e8400-e29b-41d4-a716-446655440002',
    '660e8400-e29b-41d4-a716-446655440002',
    '770e8400-e29b-41d4-a716-446655440002',
    1500000.00,
    '2024-02-15',
    'Teacher training program delivery including curriculum development and certification',
    '345678901234567890abcdef1234567890abcdef123456789012345678',
    'verified',
    '{"id":"880e8400-e29b-41d4-a716-446655440002","project_id":"660e8400-e29b-41d4-a716-446655440002","vendor_id":"770e8400-e29b-41d4-a716-446655440002","contract_amount":1500000.00,"contract_date":"2024-02-15","contract_description":"Teacher training program delivery including curriculum development and certification"}'::jsonb
),
(
    '880e8400-e29b-41d4-a716-446655440003',
    '660e8400-e29b-41d4-a716-446655440003',
    '770e8400-e29b-41d4-a716-446655440003',
    3000000.00,
    '2024-01-20',
    'Supply and installation of medical equipment including MRI, CT scanner, and surgical equipment',
    '45678901234567890abcdef1234567890abcdef1234567890123456789',
    'verified',
    '{"id":"880e8400-e29b-41d4-a716-446655440003","project_id":"660e8400-e29b-41d4-a716-446655440003","vendor_id":"770e8400-e29b-41d4-a716-446655440003","contract_amount":3000000.00,"contract_date":"2024-01-20","contract_description":"Supply and installation of medical equipment including MRI, CT scanner, and surgical equipment"}'::jsonb
);

-- Insert sample transactions
INSERT INTO transactions (id, project_id, vendor_id, transaction_type, amount, transaction_date, description, document_url, document_hash, record_hash, verification_status, canonical_json) VALUES
(
    '990e8400-e29b-41d4-a716-446655440001',
    '660e8400-e29b-41d4-a716-446655440001',
    '770e8400-e29b-41d4-a716-446655440001',
    'payment',
    500000.00,
    '2024-02-15',
    'Initial payment for school construction project - 25% advance',
    'https://documents.example.com/receipts/2024/02/receipt_001.pdf',
    'doc_hash_1234567890abcdef1234567890abcdef12345678',
    '5678901234567890abcdef1234567890abcdef123456789012345678901',
    'verified',
    '{"id":"990e8400-e29b-41d4-a716-446655440001","project_id":"660e8400-e29b-41d4-a716-446655440001","vendor_id":"770e8400-e29b-41d4-a716-446655440001","transaction_type":"payment","amount":500000.00,"transaction_date":"2024-02-15","description":"Initial payment for school construction project - 25% advance"}'::jsonb
),
(
    '990e8400-e29b-41d4-a716-446655440002',
    '660e8400-e29b-41d4-a716-446655440001',
    '770e8400-e29b-41d4-a716-446655440001',
    'payment',
    750000.00,
    '2024-05-20',
    'Second payment for school construction - foundation completion',
    'https://documents.example.com/receipts/2024/05/receipt_002.pdf',
    'doc_hash_2345678901abcdef1234567890abcdef12345678',
    '678901234567890abcdef1234567890abcdef1234567890123456789012',
    'verified',
    '{"id":"990e8400-e29b-41d4-a716-446655440002","project_id":"660e8400-e29b-41d4-a716-446655440001","vendor_id":"770e8400-e29b-41d4-a716-446655440001","transaction_type":"payment","amount":750000.00,"transaction_date":"2024-05-20","description":"Second payment for school construction - foundation completion"}'::jsonb
),
(
    '990e8400-e29b-41d4-a716-446655440003',
    '660e8400-e29b-41d4-a716-446655440002',
    '770e8400-e29b-41d4-a716-446655440002',
    'payment',
    400000.00,
    '2024-03-10',
    'Payment for teacher training program - first phase',
    'https://documents.example.com/receipts/2024/03/receipt_003.pdf',
    'doc_hash_3456789012abcdef1234567890abcdef12345678',
    '78901234567890abcdef1234567890abcdef12345678901234567890123',
    'verified',
    '{"id":"990e8400-e29b-41d4-a716-446655440003","project_id":"660e8400-e29b-41d4-a716-446655440002","vendor_id":"770e8400-e29b-41d4-a716-446655440002","transaction_type":"payment","amount":400000.00,"transaction_date":"2024-03-10","description":"Payment for teacher training program - first phase"}'::jsonb
),
(
    '990e8400-e29b-41d4-a716-446655440004',
    '660e8400-e29b-41d4-a716-446655440003',
    '770e8400-e29b-41d4-a716-446655440003',
    'payment',
    1200000.00,
    '2024-03-25',
    'Payment for MRI machine delivery and installation',
    'https://documents.example.com/receipts/2024/03/receipt_004.pdf',
    'doc_hash_4567890123abcdef1234567890abcdef12345678',
    '8901234567890abcdef1234567890abcdef123456789012345678901234',
    'verified',
    '{"id":"990e8400-e29b-41d4-a716-446655440004","project_id":"660e8400-e29b-41d4-a716-446655440003","vendor_id":"770e8400-e29b-41d4-a716-446655440003","transaction_type":"payment","amount":1200000.00,"transaction_date":"2024-03-25","description":"Payment for MRI machine delivery and installation"}'::jsonb
),
(
    '990e8400-e29b-41d4-a716-446655440005',
    '660e8400-e29b-41d4-a716-446655440003',
    '770e8400-e29b-41d4-a716-446655440003',
    'payment',
    1000000.00,
    '2024-06-15',
    'Payment for CT scanner and surgical equipment installation',
    'https://documents.example.com/receipts/2024/06/receipt_005.pdf',
    'doc_hash_5678901234abcdef1234567890abcdef12345678',
    '901234567890abcdef1234567890abcdef1234567890123456789012345',
    'verified',
    '{"id":"990e8400-e29b-41d4-a716-446655440005","project_id":"660e8400-e29b-41d4-a716-446655440003","vendor_id":"770e8400-e29b-41d4-a716-446655440003","transaction_type":"payment","amount":1000000.00,"transaction_date":"2024-06-15","description":"Payment for CT scanner and surgical equipment installation"}'::jsonb
);

-- Insert sample approvals (digital signatures)
INSERT INTO approvals (id, approver_name, approver_role, approver_email, signature, public_key, related_record_id, related_record_type, approval_status, comments) VALUES
(
    'aa0e8400-e29b-41d4-a716-446655440001',
    'Dr. Sarah Johnson',
    'Education Director',
    'sarah.johnson@gov.edu',
    'MEUCIQDxyz123abc456def789ghi012jkl345mno678pqr901stu234vwx567yzab890==',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdef...\n-----END PUBLIC KEY-----',
    '550e8400-e29b-41d4-a716-446655440001',
    'budget',
    'approved',
    'Education budget approved for 2024 fiscal year'
),
(
    'aa0e8400-e29b-41d4-a716-446655440002',
    'Dr. Michael Chen',
    'Healthcare Administrator',
    'michael.chen@gov.health',
    'MEUCIQDabc123def456ghi789jkl012mno345pqr678stu901vwx234yzab567cde890==',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAabcdef1234567890...\n-----END PUBLIC KEY-----',
    '550e8400-e29b-41d4-a716-446655440002',
    'budget',
    'approved',
    'Healthcare budget approved with additional emergency fund allocation'
),
(
    'aa0e8400-e29b-41d4-a716-446655440003',
    'Robert Martinez',
    'Project Manager',
    'robert.martinez@gov.edu',
    'MEUCIQDdef456ghi789jkl012mno345pqr678stu901vwx234yzab567cde890fgh123==',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAdef456ghi789012...\n-----END PUBLIC KEY-----',
    '660e8400-e29b-41d4-a716-446655440001',
    'project',
    'approved',
    'School construction project approved with environmental compliance verification'
),
(
    'aa0e8400-e29b-41d4-a716-446655440004',
    'Lisa Thompson',
    'Finance Controller',
    'lisa.thompson@gov.finance',
    'MEUCIQDghi789jkl012mno345pqr678stu901vwx234yzab567cde890fgh123ijk456==',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAghi789jkl012345...\n-----END PUBLIC KEY-----',
    '990e8400-e29b-41d4-a716-446655440001',
    'transaction',
    'approved',
    'Payment approved after verification of construction milestone completion'
);

-- Insert sample subscriptions
INSERT INTO subscriptions (id, email, subscription_type, filter_criteria, is_active) VALUES
(
    'bb0e8400-e29b-41d4-a716-446655440001',
    'citizen1@example.com',
    'budget',
    '{"department": "Education", "year": 2024}'::jsonb,
    TRUE
),
(
    'bb0e8400-e29b-41d4-a716-446655440002',
    'parent@example.com',
    'project',
    '{"project_name_contains": "School"}'::jsonb,
    TRUE
),
(
    'bb0e8400-e29b-41d4-a716-446655440003',
    'taxpayer@example.com',
    'all',
    '{}'::jsonb,
    TRUE
),
(
    'bb0e8400-e29b-41d4-a716-446655440004',
    'journalist@news.com',
    'transaction',
    '{"amount_greater_than": 100000}'::jsonb,
    TRUE
);

-- Update spent amounts in projects based on transactions
UPDATE projects SET spent_amount = (
    SELECT COALESCE(SUM(amount), 0)
    FROM transactions 
    WHERE project_id = projects.id AND transaction_type = 'payment'
);

-- Add some sample audit log entries (these would normally be created by triggers)
INSERT INTO audit_log (table_name, record_id, action, new_values, changed_by, ip_address) VALUES
(
    'budgets',
    '550e8400-e29b-41d4-a716-446655440001',
    'INSERT',
    '{"department": "Education", "year": 2024, "total_amount": 5000000.00}'::jsonb,
    'admin@gov.system',
    '192.168.1.100'::inet
),
(
    'transactions',
    '990e8400-e29b-41d4-a716-446655440001',
    'INSERT',
    '{"amount": 500000.00, "transaction_type": "payment", "project_id": "660e8400-e29b-41d4-a716-446655440001"}'::jsonb,
    'finance@gov.system',
    '192.168.1.101'::inet
);

-- Create some additional indexes for better query performance with sample data
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount);
CREATE INDEX IF NOT EXISTS idx_projects_spent_amount ON projects(spent_amount);
CREATE INDEX IF NOT EXISTS idx_budgets_total_amount ON budgets(total_amount);

-- Refresh materialized views if any exist (none in this schema, but good practice)
-- REFRESH MATERIALIZED VIEW budget_summary;

COMMIT;
