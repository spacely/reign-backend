const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// POST /connect - Create a new connection between users
router.post('/', async (req, res) => {
    const { fromUser, toUser } = req.body;

    // Validate required fields
    if (!fromUser || !toUser) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: {
                fromUser: !fromUser ? 'Missing fromUser' : null,
                toUser: !toUser ? 'Missing toUser' : null
            }
        });
    }

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(fromUser) || !UUID_REGEX.test(toUser)) {
        return res.status(400).json({
            error: 'Invalid user ID format',
            details: 'Both fromUser and toUser must be valid UUIDs'
        });
    }

    // Prevent self-connections
    if (fromUser === toUser) {
        return res.status(400).json({
            error: 'Invalid connection',
            details: 'Cannot connect user to themselves'
        });
    }

    try {
        // First check if both users exist
        const usersCheck = await pool.query(
            'SELECT id FROM users WHERE id IN ($1, $2)',
            [fromUser, toUser]
        );

        if (usersCheck.rows.length !== 2) {
            return res.status(404).json({
                error: 'User not found',
                details: 'One or both users do not exist'
            });
        }

        // Create connection with UPSERT to avoid duplicate errors
        const result = await pool.query(
            `INSERT INTO connections (from_user, to_user) 
             VALUES ($1, $2) 
             ON CONFLICT (from_user, to_user) DO NOTHING
             RETURNING *`,
            [fromUser, toUser]
        );

        // Check if connection was created or already existed
        if (result.rows.length > 0) {
            res.json({
                status: 'ok',
                message: 'Connected successfully'
            });
        } else {
            res.status(200).json({
                status: 'ok',
                message: 'Already connected'
            });
        }
    } catch (err) {

        console.error('Error creating connection:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// GET /connections/:userId - Get all connections for a user
router.get('/:userId', async (req, res) => {
    const { userId } = req.params;

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(userId)) {
        return res.status(400).json({
            error: 'Invalid user ID format',
            details: 'User ID must be a valid UUID'
        });
    }

    try {
        // Check if user exists
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${userId}`
            });
        }

        // Fetch all connections where user is either from_user or to_user
        const result = await pool.query(
            `SELECT 
                CASE 
                    WHEN from_user = $1 THEN to_user
                    ELSE from_user
                END as connected_user_id
            FROM connections 
            WHERE from_user = $1 OR to_user = $1`,
            [userId]
        );

        res.json(result.rows.map(row => row.connected_user_id));
    } catch (err) {
        console.error('Error fetching connections:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

module.exports = router; 