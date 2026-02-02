import db from '../db.js';
import { createNotification } from './notifications.js';

export const startDeadlineChecker = () => {
  const checkDeadlines = () => {
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // 1. Projects due in < 24h
      const projects = db.prepare(`
        SELECT p.*, u.name as manager_name 
        FROM projects p
        LEFT JOIN users u ON p.manager_id = u.id
        WHERE p.end_date IS NOT NULL 
        AND p.end_date <= ? 
        AND p.status IN ('active', 'paused')
        AND p.deadline_notified = 0
      `).all(tomorrowStr);

      for (const project of projects) {
        // Notify Manager
        if (project.manager_id) {
          createNotification(
            project.manager_id,
            'Project Deadline Approaching',
            `Project "${project.name}" is due within 24 hours.`,
            'project_deadline',
            `/projects/${project.id}`
          );
        }
        
        // Notify Admin(s)
        const admins = db.prepare(`
          SELECT user_id FROM team_members 
          WHERE team_id = ? AND role = 'admin'
        `).all(project.organization_id);

        for (const admin of admins) {
          if (admin.user_id !== project.manager_id) {
              createNotification(
                admin.user_id,
                'Project Deadline Approaching',
                `Project "${project.name}" (Manager: ${project.manager_name}) is due within 24 hours.`,
                'project_deadline',
                `/projects/${project.id}`
              );
          }
        }

        db.prepare('UPDATE projects SET deadline_notified = 1 WHERE id = ?').run(project.id);
      }

      // 2. Tasks due in < 24h
      const tasks = db.prepare(`
        SELECT t.*, p.name as project_name, p.manager_id, u.name as assigned_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.due_date IS NOT NULL 
        AND t.due_date <= ? 
        AND t.status NOT IN ('Done', 'Verified')
        AND t.deadline_notified = 0
      `).all(tomorrowStr);

      for (const task of tasks) {
        // Notify Assigned User if not submitted
        if (task.assigned_to && ['To do', 'Started'].includes(task.status)) {
          createNotification(
            task.assigned_to,
            'Task Deadline Approaching',
            `Your task "${task.title}" in project "${task.project_name}" is due within 24 hours. Please submit it.`,
            'task_deadline',
            `/projects/${task.project_id}?tasks=${task.id}`
          );
        }

        // Notify Manager
        if (task.manager_id) {
           createNotification(
             task.manager_id,
             'Task Deadline Approaching',
             `Task "${task.title}" (Assigned to: ${task.assigned_name || 'Unassigned'}) in project "${task.project_name}" is due within 24 hours and is still ${task.status}.`,
             'task_deadline',
             `/projects/${task.project_id}?tasks=${task.id}`
           );
        }

        db.prepare('UPDATE tasks SET deadline_notified = 1 WHERE id = ?').run(task.id);
      }
    } catch (error) {
      console.error('Error in deadline checker:', error);
    }
  };

  // Check every hour (3600000 ms)
  setInterval(checkDeadlines, 3600000);
  
  // Also run initially after a short delay
  setTimeout(checkDeadlines, 5000);
  
  console.log('✓ Deadline checker service started');
};
