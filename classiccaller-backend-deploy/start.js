const { execSync } = require('child_process');

console.log('=== Classic Caller — Starting up ===');

// 1. Run migrations
console.log('Running database migrations...');
execSync('node src/migrate.js', { stdio: 'inherit' });

// 2. Start server
console.log('Starting server...');
require('./src/server.js');
