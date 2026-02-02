import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const db = new Database(process.env.DATABASE_URL || 'database.sqlite');
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'manager', 'user', 'client')) DEFAULT 'user',
    bio TEXT,
    active_organization_id INTEGER,
    is_verified INTEGER DEFAULT 0,
    verification_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(active_organization_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'manager', 'user', 'client')) DEFAULT 'user',
    invited_by INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    status TEXT CHECK(status IN ('pending', 'accepted', 'declined', 'expired')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES teams(id),
    FOREIGN KEY(invited_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    organization_id INTEGER NOT NULL,
    manager_id INTEGER,
    client_id INTEGER,
    start_date DATE,
    end_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(organization_id) REFERENCES teams(id),
    FOREIGN KEY(manager_id) REFERENCES users(id),
    FOREIGN KEY(client_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to INTEGER,
    status TEXT NOT NULL DEFAULT 'To do',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(assigned_to) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER,
    user_id INTEGER,
    role TEXT CHECK(role IN ('admin', 'manager', 'user', 'client')) DEFAULT 'user',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(team_id, user_id),
    FOREIGN KEY(team_id) REFERENCES teams(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    filename TEXT NOT NULL,
    file_type TEXT,
    size INTEGER,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    user_id INTEGER,
    content TEXT NOT NULL,
    attachment_name TEXT,
    attachment_type TEXT,
    attachment_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    user_id INTEGER,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES tasks(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER,
    user_id INTEGER,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, user_id),
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY(task_id, user_id),
    FOREIGN KEY(task_id) REFERENCES tasks(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    type TEXT DEFAULT 'info',
    link TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    client_id INTEGER,
    organization_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    status TEXT CHECK(status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')) DEFAULT 'draft',
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    total_amount REAL DEFAULT 0,
    notes TEXT,
    manual_client_name TEXT,
    manual_client_email TEXT,
    manual_client_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(client_id) REFERENCES users(id),
    FOREIGN KEY(organization_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL,
    project_id INTEGER,
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    date DATE NOT NULL,
    category TEXT,
    vendor TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(organization_id) REFERENCES teams(id),
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
`);

// Add active_organization_id column to existing users table if it doesn't exist
try {
  db.exec(`ALTER TABLE users ADD COLUMN active_organization_id INTEGER REFERENCES teams(id);`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN bio TEXT;`);
} catch (e) {}

// Migrate old organization_id to active_organization_id
try {
  const hasOldColumn = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='organization_id'").get();
  if (hasOldColumn && hasOldColumn.count > 0) {
    db.exec(`UPDATE users SET active_organization_id = organization_id WHERE organization_id IS NOT NULL`);
    console.log('✓ Migrated organization_id to active_organization_id');
  }
} catch (e) {
  console.log('Note: Migration check completed');
}

// Add budget and paid columns to existing projects table
try {
  db.exec(`ALTER TABLE projects ADD COLUMN budget REAL DEFAULT 0;`);
  db.exec(`ALTER TABLE projects ADD COLUMN paid REAL DEFAULT 0;`);
  console.log('✓ Added financial columns to projects table');
} catch (e) {}

// Add created_by column to tasks table
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN created_by INTEGER REFERENCES users(id);`);
  console.log('✓ Added created_by to tasks table');
} catch (e) {}

// Fix messages table foreign key if it was created incorrectly
try {
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get();
  if (tableInfo && tableInfo.sql.includes('REFERENCES messages(id)')) {
    console.log('fixing messages table foreign key...');
    db.exec(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      ALTER TABLE messages RENAME TO messages_old;
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        user_id INTEGER,
        content TEXT NOT NULL,
        attachment_name TEXT,
        attachment_type TEXT,
        attachment_size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      INSERT INTO messages (id, project_id, user_id, content, created_at) 
      SELECT id, project_id, user_id, content, created_at FROM messages_old;
      DROP TABLE messages_old;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('✓ Fixed messages table foreign key');
  }
} catch (e) {
  console.error('Error during messages table migration:', e);
}

// Add attachment columns to projects and messages if missing
try { db.exec(`ALTER TABLE messages ADD COLUMN attachment_name TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE messages ADD COLUMN attachment_type TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE messages ADD COLUMN attachment_size INTEGER;`); } catch(e){}
try { db.exec(`ALTER TABLE notifications ADD COLUMN link TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE invoices ADD COLUMN manual_client_name TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE invoices ADD COLUMN manual_client_email TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE projects ADD COLUMN deadline_notified INTEGER DEFAULT 0;`); } catch(e){}
try { db.exec(`ALTER TABLE tasks ADD COLUMN deadline_notified INTEGER DEFAULT 0;`); } catch(e){}

try { db.exec(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0;`); } catch(e){}
try { db.exec(`ALTER TABLE users ADD COLUMN verification_token TEXT;`); } catch(e){}

// Advanced Invoice Support - Schema Updates
try { db.exec(`ALTER TABLE teams ADD COLUMN address TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE teams ADD COLUMN logo_url TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE teams ADD COLUMN phone TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE teams ADD COLUMN website TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE teams ADD COLUMN business_email TEXT;`); } catch(e){}

try { db.exec(`ALTER TABLE users ADD COLUMN address TEXT;`); } catch(e){}
try { db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`); } catch(e){}

try { db.exec(`ALTER TABLE invoices ADD COLUMN manual_client_address TEXT;`); } catch(e){}

console.log('Database schema ready!');

export default db;
