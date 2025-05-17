const { Pool } = require('pg');

// Railway automatically injects DATABASE_URL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for Railway's PostgreSQL
    }
});

// Export the pool for use in other files
module.exports = pool; 