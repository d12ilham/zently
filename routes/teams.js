import express from 'express';
import db from '../db.js';
import bcrypt from 'bcryptjs';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Get user's organization (users see their own organization only)
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all organizations user belongs to
    const teams = db.prepare(`
      SELECT t.*, 
        u.name as owner_name,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN users u ON t.owner_id = u.id
      WHERE tm.user_id = ?
      ORDER BY t.name ASC
    `).all(userId);
    
    res.json(teams);
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create organization (First user becomes admin/owner)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const userId = req.user.id;
    
    // Create organization
    const info = db.prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)').run(name, description, userId);
    const teamId = info.lastInsertRowid;
    
    // Assign user to organization and make them admin (set as active org)
    db.prepare('UPDATE users SET active_organization_id = ? WHERE id = ?').run(teamId, userId);
    
    // Add user to team_members
    db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, userId, 'admin');
    
    // Get updated user for new token
    const updatedUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
    
    // Generate new token with active_organization_id and role
    const newToken = jwt.sign(
      { id: updatedUser.id, email: updatedUser.email, role: 'admin', active_organization_id: teamId },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.status(201).json({ 
      id: teamId, 
      name, 
      description, 
      message: 'Organization created successfully. You are now the admin.',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: 'admin',
        active_organization_id: teamId
      },
      token: newToken // New token with organization_id
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get users (for assignment dropdowns) - filtered by organization
router.get('/users', authenticateToken, (req, res) => {
  try {
    let userOrgId = req.user.active_organization_id;
    const { role } = req.query;
    
    // Fallback: If no active org in token, find the first one from DB
    if (!userOrgId) {
      const membership = db.prepare('SELECT team_id FROM team_members WHERE user_id = ? LIMIT 1').get(req.user.id);
      if (membership) {
        userOrgId = membership.team_id;
      } else {
        return res.json([]);
      }
    }
    
    // Get users from team_members join
    let query = `
      SELECT u.id, u.name, u.email, tm.role 
      FROM users u
      JOIN team_members tm ON u.id = tm.user_id
      WHERE tm.team_id = ?
    `;
    const params = [userOrgId];
    
    if (role) {
      query += ' AND tm.role = ?';
      params.push(role);
    }
    
    query += ' ORDER BY u.name ASC';
    
    const users = db.prepare(query).all(...params);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get organization details with members
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    
    // Security: Can only view organization if member
    const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId);
    
    if (!membership && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. You are not a member of this organization.' });
    }
    
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.status(404).json({ error: 'Organization not found' });

    // Get active projects count
    const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects WHERE organization_id = ? AND status != ?').get(teamId, 'archived').count;

    // Get pending tasks count
    const taskCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE p.organization_id = ? AND t.status != ?
    `).get(teamId, 'Done').count;

    // Get members from the organization
    // JOIN with team_members to get the role specific to this organization
    const members = db.prepare(`
      SELECT u.id, u.name, u.email, tm.role, tm.joined_at as created_at
      FROM users u
      JOIN team_members tm ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY 
        CASE tm.role
          WHEN 'admin' THEN 1
          WHEN 'manager' THEN 2
          WHEN 'user' THEN 3
          WHEN 'client' THEN 4
        END,
        tm.joined_at ASC
    `).all(teamId);

    res.json({ ...team, members, project_count: projectCount, task_count: taskCount });
  } catch (error) {
    console.error('Error fetching organization details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update organization details
router.put('/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const { name, description, address, phone, website, business_email, logo_url } = req.body;
    const userOrgId = req.user.active_organization_id;

    if (teamId !== userOrgId) return res.status(403).json({ error: 'Access denied' });

    db.prepare(`
      UPDATE teams 
      SET name = ?, description = ?, address = ?, phone = ?, website = ?, business_email = ?, logo_url = ?
      WHERE id = ?
    `).run(
      name, 
      description, 
      address || null, 
      phone || null, 
      website || null, 
      business_email || null, 
      logo_url || null, 
      teamId
    );

    res.json({ message: 'Organization updated successfully' });
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add member to organization (Admin only)
router.post('/:id/members', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const { user_id, role } = req.body;
    const userOrgId = req.user.active_organization_id;
    
    // Security: Can only add members to own organization
    if (teamId !== userOrgId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Check if user exists
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user already belongs to this organization
    const isMember = db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user_id);
    if (isMember) {
      return res.status(400).json({ error: 'User already belongs to this organization' });
    }
    
    // Add to team_members
    db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, user_id, role || 'user');
    
    // If user has no active org, set this one
    if (!targetUser.active_organization_id) {
       db.prepare('UPDATE users SET active_organization_id = ? WHERE id = ?').run(teamId, user_id);
    }
    
    res.status(201).json({ message: 'Member added to organization' });
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove member from organization (Admin only - cannot remove yourself)
router.delete('/:id/members/:userId', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    const currentUserId = req.user.id;
    const userOrgId = req.user.active_organization_id;
    
    // Security: Can only remove members from own organization
    if (teamId !== userOrgId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Cannot remove yourself
    if (targetUserId === currentUserId) {
      return res.status(400).json({ error: 'Cannot remove yourself from organization' });
    }
    
    // Remove from team_members
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, targetUserId);
    
    // Ensure user active_organization_id is updated if it was this org
    const targetUser = db.prepare('SELECT active_organization_id FROM users WHERE id = ?').get(targetUserId);
    if (targetUser && targetUser.active_organization_id === teamId) {
      // Find another org to set as active, or set null
      const otherOrg = db.prepare('SELECT team_id FROM team_members WHERE user_id = ? LIMIT 1').get(targetUserId);
      const newActiveId = otherOrg ? otherOrg.team_id : null;
      db.prepare('UPDATE users SET active_organization_id = ? WHERE id = ?').run(newActiveId, targetUserId);
    }
    
    res.json({ message: 'Member removed from organization' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new client/user and add to organization (Admin only)
router.post('/:id/create-client', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        const { name, email, password } = req.body;
        const userOrgId = req.user.active_organization_id;
        
        if (teamId !== userOrgId) return res.status(403).json({ error: 'Access denied' });

        // Check if user exists
        let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        
        if (!user) {
            const hashedPassword = await bcrypt.hash(password || 'Client123!', 10);
            const info = db.prepare('INSERT INTO users (name, email, password, role, active_organization_id) VALUES (?, ?, ?, ?, ?)')
                .run(name, email, hashedPassword, 'client', teamId);
            user = { id: info.lastInsertRowid };
        } else {
            // If user exists, ensure they are also set as client role in users table if needed,
            // but primarily we link them via team_members
            db.prepare('UPDATE users SET role = "client" WHERE id = ? AND role = "user"').run(user.id);
        }

        // Add to team_members as client
        const isMember = db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id);
        if (!isMember) {
            db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, user.id, 'client');
        } else {
            db.prepare('UPDATE team_members SET role = "client" WHERE team_id = ? AND user_id = ?').run(teamId, user.id);
        }

        res.status(201).json({ message: 'Client created successfully' });
    } catch (error) {
        console.error('Error creating client:', error);
        res.status(500).json({ error: error.message });
    }
});


export default router;
