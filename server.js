const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const XLSX = require('xlsx');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Login Route
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    res.json({ id: user.id, name: user.full_name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Master Data
app.get('/api/master-data', async (req, res) => {
  try {
    const branches = await pool.query('SELECT * FROM branches ORDER BY name');
    const issueTypes = await pool.query('SELECT * FROM issue_types ORDER BY name');
    const staff = await pool.query("SELECT id, full_name FROM users WHERE role = 'IT_STAFF'");
    res.json({ branches: branches.rows, issueTypes: issueTypes.rows, staff: staff.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log Issues (Bulk Assign Support)
app.post('/api/issues', async (req, res) => {
  const { branch_ids, issue_type_id, description, priority, assigned_to } = req.body;
  try {
    for (let branch_id of branch_ids) {
      await pool.query(
        'INSERT INTO issues (branch_id, issue_type_id, description, priority, assigned_to) VALUES ($1, $2, $3, $4, $5)',
        [branch_id, issue_type_id, description, priority, assigned_to]
      );
    }
    res.json({ message: 'Issues logged successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Issues (Admin View)
app.get('/api/issues/admin', async (req, res) => {
  try {
    const query = `
      SELECT i.*, b.name as branch_name, it.name as issue_type_name, u.full_name as assigned_staff 
      FROM issues i 
      JOIN branches b ON i.branch_id = b.id 
      JOIN issue_types it ON i.issue_type_id = it.id 
      LEFT JOIN users u ON i.assigned_to = u.id 
      ORDER BY i.id DESC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Assigned Issues (Staff View)
app.get('/api/issues/staff/:id', async (req, res) => {
  try {
    const query = `
      SELECT i.*, b.name as branch_name, it.name as issue_type_name 
      FROM issues i 
      JOIN branches b ON i.branch_id = b.id 
      JOIN issue_types it ON i.issue_type_id = it.id 
      WHERE i.assigned_to = $1 
      ORDER BY i.id DESC`;
    const result = await pool.query(query, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Status by Staff
app.put('/api/issues/:id', async (req, res) => {
  const { status, remarks } = req.body;
  const resolvedAt = (status === 'Resolved' || status === 'Closed') ? new Date() : null;
  try {
    await pool.query(
      'UPDATE issues SET status = $1, remarks = $2, resolved_at = COALESCE($3, resolved_at) WHERE id = $4',
      [status, remarks, resolvedAt, req.params.id]
    );
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export Excel Report
app.get('/api/export', async (req, res) => {
  try {
    const query = `
      SELECT i.id, b.name as branch, it.name as issue_type, i.description, i.priority, 
             u.full_name as staff, i.status, i.reported_at, i.resolved_at, i.remarks 
      FROM issues i 
      JOIN branches b ON i.branch_id = b.id 
      JOIN issue_types it ON i.issue_type_id = it.id 
      LEFT JOIN users u ON i.assigned_to = u.id 
      ORDER BY i.id DESC`;
    const result = await pool.query(query);
    const worksheet = XLSX.utils.json_to_sheet(result.rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Issues Report");
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="IT_Helpdesk_Report.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));