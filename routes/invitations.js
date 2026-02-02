import express from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authenticateToken, authorizeRole, generateToken } from '../middleware/auth.js';
import { sendInvitationEmail } from '../services/email.js';

const router = express.Router();

// Send invitation (Admin only)
router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { email, role, organization_id } = req.body;
    const invitedBy = req.user.id;
    
    // Validate input
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }
    
    // Verify admin belongs to this organization
    const isMember = db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?').get(organization_id, invitedBy);
    if (!isMember) {
      return res.status(403).json({ error: 'You do not belong to this organization' });
    }
    
    // Check if user is already a member
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      const alreadyMember = db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?').get(organization_id, existingUser.id);
      if (alreadyMember) {
        return res.status(400).json({ error: 'User is already a member of this organization' });
      }
    }
    
    // Check for pending invitation
    const pendingInvite = db.prepare(
      'SELECT * FROM invitations WHERE email = ? AND organization_id = ? AND status = \'pending\''
    ).get(email, organization_id);
    
    if (pendingInvite) {
      return res.status(400).json({ error: 'Invitation already sent to this email' });
    }
    
    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');
    
    // Set expiry to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Create invitation
    const info = db.prepare(`
      INSERT INTO invitations (organization_id, email, role, invited_by, token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(organization_id, email, role, invitedBy, token, expiresAt.toISOString());
    
    // Get organization and inviter details for email
    const organization = db.prepare('SELECT name FROM teams WHERE id = ?').get(organization_id);
    const inviter = db.prepare('SELECT name FROM users WHERE id = ?').get(invitedBy);
    
    // Send email
    const invitationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invitation?token=${token}`;
    await sendInvitationEmail(email, invitationLink, organization.name, role);
    
    res.status(201).json({
      id: info.lastInsertRowid,
      message: 'Invitation sent successfully',
      invitationLink, // For testing - remove in production
      organization: organization.name,
      inviter: inviter.name,
      email,
      role,
      expiresAt
    });
  } catch (error) {
    console.error('Error creating invitation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pending invitations for a user
router.get('/pending', authenticateToken, (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const invitations = db.prepare(`
      SELECT i.*, 
        t.name as organization_name,
        u.name as inviter_name
      FROM invitations i
      JOIN teams t ON i.organization_id = t.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.email = ? 
        AND i.status = 'pending'
        AND datetime(i.expires_at) > datetime('now')
      ORDER BY i.created_at DESC
    `).all(userEmail);
    
    res.json(invitations);
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify invitation token (public endpoint)
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    const invitation = db.prepare(`
      SELECT i.*,
        t.name as organization_name,
        u.name as inviter_name
      FROM invitations i
      JOIN teams t ON i.organization_id = t.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.token = ?
    `).get(token);
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Invitation has already been ' + invitation.status });
    }
    
    if (new Date(invitation.expires_at) < new Date()) {
      // Mark as expired
      db.prepare('UPDATE invitations SET status = \'expired\' WHERE id = ?').run(invitation.id);
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    res.json({
      email: invitation.email,
      role: invitation.role,
      organization_name: invitation.organization_name,
      inviter_name: invitation.inviter_name,
      created_at: invitation.created_at
    });
  } catch (error) {
    console.error('Error verifying invitation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Accept invitation
router.post('/accept', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    const invitation = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token);
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.email !== userEmail) {
      return res.status(403).json({ error: 'This invitation is not for your email address' });
    }
    
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Invitation has already been ' + invitation.status });
    }
    
    if (new Date(invitation.expires_at) < new Date()) {
      db.prepare('UPDATE invitations SET status = \'expired\' WHERE id = ?').run(invitation.id);
      return res.status(400).json({ error: 'Invitation has expired' });
    }
    
    // Check if already a member
    const alreadyMember = db.prepare(
      'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?'
    ).get(invitation.organization_id, userId);
    
    if (alreadyMember) {
      return res.status(400).json({ error: 'You are already a member of this organization' });
    }
    
    // Add user to organization
    db.prepare(
      'INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)'
    ).run(invitation.organization_id, userId, invitation.role);
    
    // Update invitation status
    db.prepare('UPDATE invitations SET status = \'accepted\' WHERE id = ?').run(invitation.id);
    
    // Auto-set as active org if the user currently has none
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    let activeOrgId = user.active_organization_id;
    let role = user.role;

    if (!activeOrgId) {
      activeOrgId = invitation.organization_id;
      role = invitation.role;
      db.prepare('UPDATE users SET active_organization_id = ? WHERE id = ?').run(activeOrgId, userId);
    }
    
    // Get organization details
    const organization = db.prepare('SELECT * FROM teams WHERE id = ?').get(invitation.organization_id);
    
    // Generate new token to include the new organization membership if needed
    // However, it's safer to always refresh the token here so the UI has the latest state
    const tokenData = {
      ...user,
      active_organization_id: activeOrgId,
      role: activeOrgId === invitation.organization_id ? invitation.role : role
    };
    const newToken = generateToken(tokenData);

    res.json({
      message: 'Invitation accepted successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: tokenData.role,
        active_organization_id: activeOrgId
      },
      token: newToken,
      organization: {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        role: invitation.role
      }
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Decline invitation
router.post('/decline', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    const userEmail = req.user.email;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    const invitation = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token);
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.email !== userEmail) {
      return res.status(403).json({ error: 'This invitation is not for your email address' });
    }
    
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Invitation has already been ' + invitation.status });
    }
    
    // Update invitation status
    db.prepare('UPDATE invitations SET status = \'declined\' WHERE id = ?').run(invitation.id);
    
    res.json({ message: 'Invitation declined' });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get organization invitations (Admin only)
router.get('/organization/:orgId', authenticateToken, authorizeRole(['admin']), (req, res) => {
  try {
    const orgId = parseInt(req.params.orgId);
    
    // Verify admin belongs to this organization
    const isMember = db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?').get(orgId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const invitations = db.prepare(`
      SELECT i.*,
        u.name as inviter_name
      FROM invitations i
      JOIN users u ON i.invited_by = u.id
      WHERE i.organization_id = ?
      ORDER BY i.created_at DESC
    `).all(orgId);
    
    res.json(invitations);
  } catch (error) {
    console.error('Error fetching organization invitations:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
