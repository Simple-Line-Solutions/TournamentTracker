const bcrypt = require('bcryptjs');
const { db } = require('./src/db/connection');

const newHash = bcrypt.hashSync('S1mpl3L1n3', 10);
db.prepare('UPDATE users SET password_hash = ? WHERE role = ?').run(newHash, 'SuperAdmin');
console.log('Contraseña actualizada');