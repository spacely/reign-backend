const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Railway automatically injects DATABASE_URL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for Railway's PostgreSQL
    }
});

// Function to bootstrap schema
async function bootstrapSchema() {
    try {
        // Read the schema file
        const schemaPath = path.join(__dirname, '../../database/schema.sql');
        const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

        // Execute the schema
        await pool.query(schemaSQL);
        console.log('Schema successfully bootstrapped');
    } catch (err) {
        console.error('Error bootstrapping schema:', err);
        throw err; // Re-throw to handle in index.js
    }
}

module.exports = {
    pool,
    bootstrapSchema
}; 