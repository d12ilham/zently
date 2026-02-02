import express from 'express';
import db from '../db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Get all users in organization (Admin/Manager)
router.get('/', authenticateToken, authorizeRole(['admin', 'manager']), (req, res) => {
  try {
    const { role } = req.query;
    const userOrgId = req.user.active_organization_id;
    
    if (!userOrgId) {
      return res.status(403).json({ error: 'User not assigned to an organization' });
    }
    
    let query = `
      SELECT u.id, u.name, u.email, tm.role, u.created_at 
      FROM users u
      JOIN team_members tm ON u.id = tm.user_id
      WHERE tm.team_id = ?
    `;
    let params = [userOrgId];
    
    if (role) {
      query += ' AND tm.role = ?';
      params.push(role);
    }
    
    query += ' ORDER BY u.created_at DESC';
    
    const users = db.prepare(query).all(...params);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new user/client in organization (Admin only)
router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const userOrgId = req.user.active_organization_id;
    
    if (!userOrgId) {
      return res.status(403).json({ error: 'User not assigned to an organization' });
    }
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    
    // Validate role
    const validRoles = ['manager', 'user', 'client'];
    const userRole = role || 'user';
   
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be manager, user, or client' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const info = db.prepare(`
      INSERT INTO users (name, email, password, role, active_organization_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, email, hashedPassword, userRole, userOrgId);
    
    // Add to team_members
    db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(userOrgId, info.lastInsertRowid, userRole);
    
    res.status(201).json({ 
      id: info.lastInsertRowid, 
      name, 
      email, 
      role: userRole,
      message: `${userRole.charAt(0).toUpperCase() + userRole.slice(1)} created successfully` 
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Email already exists' });
    } else {
      console.error('Error creating user:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

// Update user role (Admin only - within organization)
router.put('/:id/role', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role } = req.body;
    const userOrgId = req.user.active_organization_id;
    const currentUserId = req.user.id;
    
    const validRoles = ['admin', 'manager', 'user', 'client'];
    
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    // Cannot change your own role
    if (userId === currentUserId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    
    // Verify user belongs to same organization
    const targetUser = db.prepare('SELECT organization_id FROM users WHERE id = ?').get(userId);
    if (!targetUser || targetUser.organization_id !== userOrgId) {
      return res.status(403).json({ error: 'User not in your organization' });
    }
    
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    res.json({ message: 'User role updated' });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete user (Admin only - within organization, cannot delete self)
router.delete('/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userOrgId = req.user.active_organization_id;
    const currentUserId = req.user.id;
    
    // Don't allow deleting yourself
    if (userId === currentUserId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    // Verify user belongs to same organization
    const targetUser = db.prepare('SELECT organization_id FROM users WHERE id = ?').get(userId);
    if (!targetUser || targetUser.organization_id !== userOrgId) {
      return res.status(403).json({ error: 'User not in your organization' });
    }
    
    // Delete from team_members first
    db.prepare('DELETE FROM team_members WHERE user_id = ?').run(userId);
    
    // Delete user
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's organizations
router.get('/organizations', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const activeOrgId = req.user.active_organization_id;
    
    // Get all organizations user belongs to
    const organizations = db.prepare(`
      SELECT t.id, t.name, t.description, t.owner_id,
        tm.role,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
        CASE WHEN t.id = ? THEN 1 ELSE 0 END as is_active
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = ?
      ORDER BY is_active DESC, t.name ASC
    `).all(activeOrgId, userId);
    
    res.json(organizations);
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Switch active organization
router.put('/switch-organization', authenticateToken, async (req, res) => {
  try {
    const { organization_id } = req.body;
    const userId = req.user.id;
    
    if (!organization_id) {
      return res.status(400).json({ error: 'Organization ID is required' });
    }
    
    // Verify user is member of this organization
    const membership = db.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
    ).get(organization_id, userId);
    
    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this organization' });
    }
    
    // Update active organization
    db.prepare('UPDATE users SET active_organization_id = ? WHERE id = ?').run(organization_id, userId);
    
    // Get updated user info
    const updatedUser = db.prepare('SELECT id, name, email, active_organization_id FROM users WHERE id = ?').get(userId);
    
    // Get organization details
    const organization = db.prepare('SELECT * FROM teams WHERE id = ?').get(organization_id);
    
    // Generate new token with updated organization_id and role
    const newToken = jwt.sign(
      { 
        id: updatedUser.id, 
        email: updatedUser.email, 
        role: membership.role, 
        active_organization_id: organization_id 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Organization switched successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: membership.role,
        active_organization_id: organization_id
      },
      organization: {
        id: organization.id,
        name: organization.name,
        description: organization.description
      },
      token: newToken
    });
  } catch (error) {
    console.error('Error switching organization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update profile (Current User)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, bio } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    db.prepare('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(name, bio || '', userId);
    
    const updatedUser = db.prepare('SELECT id, name, email, role, active_organization_id, bio FROM users WHERE id = ?').get(userId);
    
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
