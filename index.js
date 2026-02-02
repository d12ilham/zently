import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import db from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import teamRoutes from './routes/teams.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import invitationRoutes from './routes/invitations.js';
import dashboardRoutes from './routes/dashboard.js';
import accountingRoutes from './routes/accounting.js';



import { createServer } from 'http';
import { initSocket } from './socket.js';
import { startDeadlineChecker } from './services/deadlineChecker.js';

dotenv.config();

// Start background services
startDeadlineChecker();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Initialize Socket.io
initSocket(httpServer);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/organizations', teamRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/accounting', accountingRoutes);


// Basic route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Zently Project Management API is running' });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
