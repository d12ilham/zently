import db from './db.js';
console.log(db.prepare('SELECT id, name FROM users').all());
process.exit(0);
