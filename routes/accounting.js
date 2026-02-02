import express from 'express';
import db from '../db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { generateInvoicePDF } from '../utils/pdfGenerator.js';

const router = express.Router();

// Get accounting stats (Revenue vs Expenses)
router.get('/stats', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const orgId = req.user.active_organization_id;
    if (!orgId) return res.status(403).json({ error: 'User not assigned to an organization' });

    const totalRevenue = db.prepare('SELECT SUM(total_amount) as total FROM invoices WHERE organization_id = ? AND status = ?').get(orgId, 'paid').total || 0;
    const pendingRevenue = db.prepare('SELECT SUM(total_amount) as total FROM invoices WHERE organization_id = ? AND status IN (?, ?)').get(orgId, 'sent', 'overdue').total || 0;
    const totalExpenses = db.prepare('SELECT SUM(amount) as total FROM expenses WHERE organization_id = ?').get(orgId).total || 0;

    res.json({
      totalRevenue,
      pendingRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Invoices
router.get('/invoices', authenticateToken, (req, res) => {
  try {
    const orgId = req.user.active_organization_id;
    if (!orgId) return res.status(403).json({ error: 'User not assigned to an organization' });

    let query = `
      SELECT i.*, p.name as project_name, 
             COALESCE(u.name, i.manual_client_name) as client_name,
             COALESCE(u.email, i.manual_client_email) as client_email
      FROM invoices i
      LEFT JOIN users u ON i.client_id = u.id
      LEFT JOIN projects p ON i.project_id = p.id
      WHERE i.organization_id = ?
    `;
    const params = [orgId];

    // Clients can only see their own invoices
    if (req.user.role === 'client') {
      query += ' AND i.client_id = ?';
      params.push(req.user.id);
    }

    query += ' ORDER BY i.created_at DESC';
    const invoices = db.prepare(query).all(...params);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST Create Invoice (Admin only)
router.post('/invoices', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const orgId = req.user.active_organization_id;
    const { project_id, client_id, invoice_number, issue_date, due_date, items, notes, manual_client_name, manual_client_email } = req.body;

    if (!invoice_number || !issue_date || !due_date || !items || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!client_id && !manual_client_name) {
      return res.status(400).json({ error: 'Either a registered client or a manual client name must be provided' });
    }

    const total_amount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

    const info = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO invoices (project_id, client_id, organization_id, invoice_number, issue_date, due_date, total_amount, notes, manual_client_name, manual_client_email, manual_client_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        project_id || null, 
        client_id || null, 
        orgId, 
        invoice_number, 
        issue_date, 
        due_date, 
        total_amount, 
        notes || '',
        manual_client_name || null,
        manual_client_email || null,
        req.body.manual_client_address || null
      );
      const invoiceId = result.lastInsertRowid;

      const itemStmt = db.prepare(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        itemStmt.run(invoiceId, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price);
      }

      return invoiceId;
    })();

    res.json({ message: 'Invoice created successfully', invoiceId: info });
  } catch (error) {
    console.error('Database error:', error);
  console.error('Failed query:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET Invoice detail
router.get('/invoices/:id', authenticateToken, (req, res) => {
  try {
    const invoice = db.prepare(`
      SELECT i.*, p.name as project_name, 
             COALESCE(u.name, i.manual_client_name) as client_name,
             COALESCE(u.email, i.manual_client_email) as client_email,
             COALESCE(u.address, i.manual_client_address) as client_address,
             u.phone as client_phone,
             t.name as org_name,
             t.address as org_address,
             t.logo_url as org_logo_url,
             t.phone as org_phone,
             t.website as org_website,
             t.business_email as org_email
      FROM invoices i
      LEFT JOIN users u ON i.client_id = u.id
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN teams t ON i.organization_id = t.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Check permissions
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.id !== invoice.client_id) {
       return res.status(403).json({ error: 'Unauthorized' });
    }

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
    res.json({ ...invoice, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT Update Invoice Status (Admin only)
router.put('/invoices/:id/status', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const { status } = req.body;
    db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ message: 'Status updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Expenses
router.get('/expenses', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const orgId = req.user.active_organization_id;
    const expenses = db.prepare(`
      SELECT e.*, p.name as project_name 
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      WHERE e.organization_id = ?
      ORDER BY e.date DESC
    `).all(orgId);
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST Create Expense
router.post('/expenses', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const orgId = req.user.active_organization_id;
    const { project_id, description, amount, date, category, vendor } = req.body;

    if (!description || !amount || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    db.prepare(`
      INSERT INTO expenses (organization_id, project_id, description, amount, date, category, vendor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orgId, project_id || null, description, amount, date, category || '', vendor || '');

    res.json({ message: 'Expense added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Download Invoice as PDF

router.get('/invoices/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const invoice = db.prepare(`
      SELECT i.*, p.name as project_name, 
             COALESCE(u.name, i.manual_client_name) as client_name,
             COALESCE(u.email, i.manual_client_email) as client_email,
             COALESCE(u.address, i.manual_client_address) as client_address,
             u.phone as client_phone,
             t.name as org_name,
             t.address as org_address,
             t.logo_url as org_logo_url,
             t.phone as org_phone,
             t.website as org_website,
             t.business_email as org_email
      FROM invoices i
      LEFT JOIN users u ON i.client_id = u.id
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN teams t ON i.organization_id = t.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.id !== invoice.client_id) {
       return res.status(403).json({ error: 'Unauthorized' });
    }

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
    
    const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
    const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
    
    const invoiceHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;line-height:1.6;padding:40px}.invoice-container{max-width:800px;margin:0 auto}.header{display:flex;justify-content:space-between;align-items:start;margin-bottom:40px;padding-bottom:20px;border-bottom:3px solid #8b5cf6}.company-info h1{font-size:32px;color:#8b5cf6;margin-bottom:8px}.company-info p{color:#666;font-size:14px}.invoice-meta{text-align:right}.invoice-meta h2{font-size:24px;color:#1a1a1a;margin-bottom:12px}.invoice-meta p{font-size:14px;color:#666;margin:4px 0}.status.paid{background:#d1fae5;color:#065f46}.status.sent{background:#dbeafe;color:#1e40af}.status.overdue{background:#fee2e2;color:#991b1b}.parties{display:flex;justify-content:space-between;margin:40px 0}.party{flex:1}.party h3{font-size:14px;text-transform:uppercase;color:#8b5cf6;margin-bottom:12px;font-weight:600}.party p{font-size:14px;color:#1a1a1a;margin:4px 0}table{width:100%;border-collapse:collapse;margin:30px 0}thead{background:#f9fafb}th{text-align:left;padding:12px;font-size:12px;font-weight:600;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb}td{padding:16px 12px;border-bottom:1px solid #f3f4f6;font-size:14px}.text-right{text-align:right}.totals{margin-top:30px;display:flex;justify-content:flex-end}.totals-table{width:300px}.totals-table tr{display:flex;justify-content:space-between;padding:8px 0}.totals-table .total-row{border-top:2px solid #8b5cf6;padding-top:12px;margin-top:8px;font-weight:700;font-size:18px;color:#8b5cf6}.notes{margin-top:40px;padding:20px;background:#f9fafb;border-radius:8px}.notes h3{font-size:14px;font-weight:600;margin-bottom:8px;color:#1a1a1a}.notes p{font-size:13px;color:#6b7280;line-height:1.6}.footer{margin-top:60px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:12px}</style></head><body><div class="invoice-container"><div class="header"><div class="company-info"><h1>${invoice.org_name || 'Zently'}</h1><p>${invoice.org_address || ''}</p><p>${invoice.org_email || ''}</p><p>${invoice.org_phone || ''}</p></div><div class="invoice-meta"><h2>INVOICE</h2><p><strong>#${invoice.invoice_number}</strong></p><p>Issue Date: ${formatDate(invoice.issue_date)}</p><p>Due Date: ${formatDate(invoice.due_date)}</p></div></div><div class="parties"><div class="party"><h3>Bill To</h3><p><strong>${invoice.client_name || 'N/A'}</strong></p><p>${invoice.client_email || ''}</p><p>${invoice.client_address || ''}</p><p>${invoice.client_phone || ''}</p></div>${invoice.project_name ? `<div class="party"><h3>Project</h3><p><strong>${invoice.project_name}</strong></p></div>` : ''}</div><table><thead><tr><th>Description</th><th class="text-right">Qty</th><th class="text-right">Unit Price</th><th class="text-right">Amount</th></tr></thead><tbody>${items.map(item => `<tr><td>${item.description}</td><td class="text-right">${item.quantity}</td><td class="text-right">${formatCurrency(item.unit_price)}</td><td class="text-right">${formatCurrency(item.amount)}</td></tr>`).join('')}</tbody></table><div class="totals"><div class="totals-table"><div class="total-row"><span>TOTAL </span><span>${formatCurrency(invoice.total_amount)}</span></div></div></div>${invoice.notes ? `<div class="notes"><h3>Notes</h3><p>${invoice.notes}</p></div>` : ''}<div class="footer"><p>Thank you for your business!</p><p>${invoice.org_website || ''}</p></div></div></body></html>`;
    
    const pdfBuffer = await generateInvoicePDF(invoiceHTML);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoice_number}.pdf`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

export default router;
