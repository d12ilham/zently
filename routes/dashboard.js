import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userOrgId = req.user.active_organization_id;
        const userRole = req.user.role;

        if (!userOrgId) {
            return res.status(403).json({ error: 'User not assigned to an organization' });
        }

        let stats = {};

        if (userRole === 'admin') {
            // Clients count
            const clientsCount = db.prepare(`
                SELECT COUNT(*) as count FROM users u
                JOIN team_members tm ON u.id = tm.user_id
                WHERE tm.team_id = ? AND (u.role = 'client' OR tm.role = 'client')
            `).get(userOrgId).count;

            // Total Projects
            const projectsCount = db.prepare('SELECT COUNT(*) as count FROM projects WHERE organization_id = ?').get(userOrgId).count;

            // Active Projects
            const activeProjectsCount = db.prepare("SELECT COUNT(*) as count FROM projects WHERE organization_id = ? AND status != 'Done'").get(userOrgId).count;

            // Revenue (Admins only)
            const revenue = db.prepare('SELECT SUM(budget) as total FROM projects WHERE organization_id = ?').get(userOrgId).total || 0;

            // Recent Activity
            const recentActivity = db.prepare(`
                SELECT a.*, u.name as user_name, p.name as project_name
                FROM activities a
                JOIN users u ON a.user_id = u.id
                JOIN projects p ON a.project_id = p.id
                WHERE p.organization_id = ?
                ORDER BY a.created_at DESC
                LIMIT 10
            `).all(userOrgId);

            // Priority Tasks
            const priorityTasks = db.prepare(`
                SELECT t.*, p.name as project_name 
                FROM tasks t
                JOIN projects p ON t.project_id = p.id
                WHERE p.organization_id = ? AND t.priority = 'high' AND t.status != 'Done'
                ORDER BY t.due_date ASC
                LIMIT 5
            `).all(userOrgId);

            // Fetch Project List with status and progress
            const projects = db.prepare(`
                SELECT p.*, 
                  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as total_tasks,
                  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'Done') as completed_tasks
                FROM projects p
                WHERE p.organization_id = ?
                ORDER BY p.created_at DESC
                LIMIT 5
            `).all(userOrgId);

            stats = {
                overview: {
                    clients: clientsCount,
                    projects: projectsCount,
                    active_now: activeProjectsCount,
                    revenue: revenue
                },
                recent_activity: recentActivity,
                priority_tasks: priorityTasks,
                projects: projects
            };
        } else if (userRole === 'manager' || userRole === 'user') {
            // Projects they are involved in
            const projectsCount = db.prepare(`
                SELECT COUNT(DISTINCT p.id) as count 
                FROM projects p
                LEFT JOIN project_members pm ON p.id = pm.project_id
                WHERE p.organization_id = ? AND (p.manager_id = ? OR pm.user_id = ?)
            `).get(userOrgId, userId, userId).count;

            const activeProjectsCount = db.prepare(`
                SELECT COUNT(DISTINCT p.id) as count 
                FROM projects p
                LEFT JOIN project_members pm ON p.id = pm.project_id
                WHERE p.organization_id = ? AND p.status != 'Done' AND (p.manager_id = ? OR pm.user_id = ?)
            `).get(userOrgId, userId, userId).count;

            // Priority Tasks assigned to them
            const priorityTasks = db.prepare(`
                SELECT DISTINCT t.*, p.name as project_name 
                FROM tasks t
                JOIN projects p ON t.project_id = p.id
                LEFT JOIN task_assignees ta ON t.id = ta.task_id
                WHERE p.organization_id = ? AND (t.assigned_to = ? OR ta.user_id = ?) AND t.priority = 'high' AND t.status != 'Done'
                ORDER BY t.due_date ASC
                LIMIT 5
            `).all(userOrgId, userId, userId);

            // Recent Activity they are involved in
            const recentActivity = db.prepare(`
                SELECT DISTINCT a.*, u.name as user_name, p.name as project_name
                FROM activities a
                JOIN users u ON a.user_id = u.id
                JOIN projects p ON a.project_id = p.id
                LEFT JOIN project_members pm ON p.id = pm.project_id
                WHERE p.organization_id = ? AND (p.manager_id = ? OR pm.user_id = ? OR a.user_id = ?)
                ORDER BY a.created_at DESC
                LIMIT 10
            `).all(userOrgId, userId, userId, userId);

            // Projects List
            const projects = db.prepare(`
                SELECT DISTINCT p.*, 
                  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as total_tasks,
                  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'Done') as completed_tasks
                FROM projects p
                LEFT JOIN project_members pm ON p.id = pm.project_id
                WHERE p.organization_id = ? AND (p.manager_id = ? OR pm.user_id = ?)
                ORDER BY p.created_at DESC
                LIMIT 5
            `).all(userOrgId, userId, userId);

            stats = {
                overview: {
                    projects: projectsCount,
                    active_now: activeProjectsCount
                },
                recent_activity: recentActivity,
                priority_tasks: priorityTasks,
                projects: projects
            };
        } else if (userRole === 'client') {
            // Active Projects count
            const activeProjectsCount = db.prepare(`
                SELECT COUNT(*) as count FROM projects 
                WHERE organization_id = ? AND client_id = ? AND status != 'Done'
            `).get(userOrgId, userId).count;

            // Projects List
            const projects = db.prepare(`
                SELECT p.*, 
                  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as total_tasks,
                  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'Done') as completed_tasks
                FROM projects p
                WHERE p.organization_id = ? AND p.client_id = ?
                ORDER BY p.created_at DESC
            `).all(userOrgId, userId);

            // Tasks across their projects
            const tasks = db.prepare(`
                SELECT t.*, p.name as project_name FROM tasks t
                JOIN projects p ON t.project_id = p.id
                WHERE p.organization_id = ? AND p.client_id = ?
                ORDER BY t.due_date ASC
                LIMIT 10
            `).all(userOrgId, userId);

            stats = {
                overview: {
                    active_now: activeProjectsCount
                },
                projects: projects,
                tasks: tasks
            };
        }

        res.json(stats);
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
