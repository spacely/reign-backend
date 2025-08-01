const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// POST /status/broadcasting - Set broadcasting status
router.post('/broadcasting', async (req, res) => {
    const { userId, is_broadcasting } = req.body;

    // Validate required fields
    if (!userId || typeof is_broadcasting !== 'boolean') {
        return res.status(400).json({
            error: 'Missing or invalid required fields',
            details: {
                userId: !userId ? 'Missing userId' : null,
                is_broadcasting: typeof is_broadcasting !== 'boolean' ? 'Must be boolean' : null
            }
        });
    }

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

        // Upsert user status
        const result = await pool.query(
            `INSERT INTO user_status (user_id, is_broadcasting, last_seen)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET is_broadcasting = EXCLUDED.is_broadcasting,
                 last_seen = NOW()
             RETURNING user_id, is_broadcasting, last_seen, updated_at`,
            [userId, is_broadcasting]
        );

        res.json({
            status: 'ok',
            message: `Broadcasting status ${is_broadcasting ? 'enabled' : 'disabled'}`,
            data: {
                userId: result.rows[0].user_id,
                isBroadcasting: result.rows[0].is_broadcasting,
                lastSeen: result.rows[0].last_seen,
                updatedAt: result.rows[0].updated_at
            }
        });
    } catch (err) {
        console.error('Error updating broadcasting status:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// POST /status/heartbeat - Update heartbeat (keep alive)
router.post('/heartbeat', async (req, res) => {
    const { userId } = req.body;

    // Validate required fields
    if (!userId) {
        return res.status(400).json({
            error: 'Missing required field',
            details: 'userId is required'
        });
    }

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

        // Update last_seen or create status record if it doesn't exist
        const result = await pool.query(
            `INSERT INTO user_status (user_id, is_broadcasting, last_seen)
             VALUES ($1, false, NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET last_seen = NOW()
             RETURNING user_id, is_broadcasting, last_seen`,
            [userId]
        );

        res.json({
            status: 'ok',
            message: 'Heartbeat updated',
            data: {
                userId: result.rows[0].user_id,
                lastSeen: result.rows[0].last_seen,
                isBroadcasting: result.rows[0].is_broadcasting
            }
        });
    } catch (err) {
        console.error('Error updating heartbeat:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// GET /status/:userId - Get user status (for debugging)
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

        // Get user status
        const result = await pool.query(
            `SELECT user_id, is_broadcasting, last_seen, created_at, updated_at
             FROM user_status 
             WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            // User exists but no status record - return default values
            return res.json({
                userId: userId,
                isBroadcasting: false,
                lastSeen: null,
                isOnline: false,
                message: 'No status record found - user defaults to offline'
            });
        }

        const statusData = result.rows[0];
        const isOnline = new Date() - new Date(statusData.last_seen) <= 3 * 60 * 1000; // 3 minutes

        res.json({
            userId: statusData.user_id,
            isBroadcasting: statusData.is_broadcasting,
            lastSeen: statusData.last_seen,
            isOnline: isOnline,
            createdAt: statusData.created_at,
            updatedAt: statusData.updated_at
        });
    } catch (err) {
        console.error('Error fetching user status:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

module.exports = router;