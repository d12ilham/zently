import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { generateToken } from '../middleware/auth.js';

const router = express.Router();

import crypto from 'crypto';
import { sendVerificationEmail } from '../services/email.js';

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Insert user (default role to 'user', real roles are in team_members)
    const info = db.prepare(
      'INSERT INTO users (name, email, password, role, is_verified, verification_token) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, email, hashedPassword, 'user', 0, verificationToken);

    await sendVerificationEmail(email, verificationToken);

    res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify Email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    db.prepare('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
    
    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resend Verification Email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }

    // Generate new token if needed or reuse existing if valid (simplification: just reuse or generate)
    // Let's generate a new one to be safe/fresh
    const verificationToken = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET verification_token = ? WHERE id = ?').run(verificationToken, user.id);

    await sendVerificationEmail(email, verificationToken);

    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    if (!user.is_verified) {
        return res.status(403).json({ error: 'Please verify your email address before logging in.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Determine active organization and role
    let activeOrgId = user.active_organization_id;
    let role = user.role;

    if (activeOrgId) {
      // Check if still member
      const member = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(activeOrgId, user.id);
      if (member) {
        role = member.role;
      } else {
        // Not a member anymore, find another org
        activeOrgId = null;
      }
    }

    // If no active org (or removed), try to find one
    if (!activeOrgId) {
      const anyOrg = db.prepare('SELECT team_id, role FROM team_members WHERE user_id = ? LIMIT 1').get(user.id);
      if (anyOrg) {
        activeOrgId = anyOrg.team_id;
        role = anyOrg.role;
        // Update user preference
        db.prepare('UPDATE users SET active_organization_id = ? WHERE id = ?').run(activeOrgId, user.id);
      }
    }

    const tokenUser = {
      ...user,
      active_organization_id: activeOrgId,
      role: role
    };

    const token = generateToken(tokenUser);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: role,
        active_organization_id: activeOrgId
      },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
