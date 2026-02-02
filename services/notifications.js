import db from '../db.js';
import { emitToUser } from '../socket.js';

/**
 * Create a notification for a user
 * @param {number} userId - The ID of the user to notify
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} type - Type of notification (info, task, project, comment)
 * @param {string} link - URL or path to follow
 */
export const createNotification = (userId, title, message, type = 'info', link = null) => {
  try {
    const info = db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, title, message, type, link);
    
    // Emit real-time notification
    emitToUser(userId, 'new_notification', {
        id: info.lastInsertRowid,
        title,
        message,
        type,
        link,
        is_read: 0,
        created_at: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error creating notification:', error);
    return false;
  }
};

/**
 * Get unread notification count for a user
 * @param {number} userId 
 */
export const getUnreadCount = (userId) => {
  const result = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return result ? result.count : 0;
};
