const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { createNearbyCondition } = require('../utils/geo');

// POST /pings
router.post('/', async (req, res) => {
    const { userId, message, mood, latitude, longitude } = req.body;

    // Validate input
    if (!userId || !message || !mood || !latitude || !longitude) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO pings (user_id, message, mood, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [userId, message, mood, latitude, longitude]
        );

        res.json({
            status: 'ok',
            message: 'Ping created successfully',
            data: {
                id: result.rows[0].id,
                userId,
                message,
                mood,
                latitude,
                longitude
            }
        });
    } catch (err) {
        console.error('Error creating ping:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /pings/nearby
router.get('/nearby', async (req, res) => {
    const { lat, lng, radius } = req.query;

    // Validate input
    if (!lat || !lng || !radius) {
        return res.status(400).json({ error: 'Missing required query parameters: lat, lng, radius' });
    }

    try {
        // Enable PostGIS earth distance functions
        await pool.query('CREATE EXTENSION IF NOT EXISTS cube; CREATE EXTENSION IF NOT EXISTS earthdistance;');

        const query = `
            SELECT 
                u.id as "userId",
                u.name,
                p.mood,
                p.message,
                p.latitude,
                p.longitude,
                p.created_at
            FROM pings p
            JOIN users u ON u.id = p.user_id
            WHERE ${createNearbyCondition('p')}
            ORDER BY p.created_at DESC;
        `;

        const result = await pool.query(query, [lat, lng, radius]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching nearby pings:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 