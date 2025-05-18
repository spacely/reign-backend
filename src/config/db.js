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

// Function to enable PostGIS extensions
async function enablePostGISExtensions(client) {
    await client.query(`
        CREATE EXTENSION IF NOT EXISTS cube;
        CREATE EXTENSION IF NOT EXISTS earthdistance;
    `);
    console.log('PostGIS extensions enabled');
}

// Function to bootstrap schema
async function bootstrapSchema() {
    const client = await pool.connect();
    try {
        // Enable PostGIS extensions first
        await enablePostGISExtensions(client);

        // Read the schema file
        const schemaPath = path.join(__dirname, '../../database/schema.sql');
        const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

        // Execute the schema
        await client.query(schemaSQL);
        console.log('Schema successfully bootstrapped');
    } catch (err) {
        console.error('Error bootstrapping schema:', err);
        throw err; // Re-throw to handle in index.js
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    bootstrapSchema,
    enablePostGISExtensions
}; 