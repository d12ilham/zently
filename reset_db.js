import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const dbPath = process.env.DATABASE_URL || "database.sqlite";
const absoluteDbPath = path.resolve(process.cwd(), dbPath);

console.log(`Resetting database at ${absoluteDbPath}...`);

// Check if file exists
if (fs.existsSync(absoluteDbPath)) {
  try {
    // Connect and clear tables
    const db = new Database(absoluteDbPath);

    // Disable foreign keys to allow truncation
    db.pragma("foreign_keys = OFF");

    const tables = [
      "users",
      "teams",
      "invitations",
      "projects",
      "tasks",
      "team_members",
      "project_members",
      "attachments",
      "activities",
      "messages",
      "task_comments",
      "notifications",
      "invoices",
      "invoice_items",
    ];

    db.transaction(() => {
      for (const table of tables) {
        try {
          db.prepare(`DELETE FROM ${table}`).run();
          // Reset auto-increment counters
          db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(table);
          console.log(`✓ Cleared table: ${table}`);
        } catch (e) {
          if (!e.message.includes("no such table")) {
            console.error(`Error clearing ${table}:`, e.message);
          }
        }
      }
    })();

    db.pragma("foreign_keys = ON");

    // Attempt VACUUM to shrink file (optional)
    try {
      db.exec("VACUUM");
    } catch (e) {
      console.log("VACUUM skipped");
    }

    console.log("Database reset successfully.");
    db.close();
  } catch (err) {
    console.error("Failed to reset database via SQL:", err);
    console.log("Attempting to delete file...");
    try {
      fs.unlinkSync(absoluteDbPath);
      console.log(
        "Database file deleted. It will be recreated on next server start.",
      );
    } catch (e) {
      console.error("Failed to delete file (likely locked):", e.message);
      console.log(
        'Please stop the server process and delete "server/database.sqlite" manually.',
      );
      process.exit(1);
    }
  }
} else {
  console.log("Database file not found. Nothing to reset.");
}
