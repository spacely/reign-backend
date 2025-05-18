const express = require('express');
const router = express.Router();
const { pool, enablePostGISExtensions } = require('../config/db');
const { createNearbyCondition } = require('../utils/geo');

// POST /pings
router.post('/', async (req, res) => {
    const { userId, message, mood, latitude, longitude } = req.body;

    // Validate input
    if (!userId || !message || !mood || !latitude || !longitude) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: {
                userId: !userId ? 'Missing userId' : null,
                message: !message ? 'Missing message' : null,
                mood: !mood ? 'Missing mood' : null,
                latitude: !latitude ? 'Missing latitude' : null,
                longitude: !longitude ? 'Missing longitude' : null
            }
        });
    }

    // Validate latitude and longitude ranges
    if (latitude < -90 || latitude > 90) {
        return res.status(400).json({
            error: 'Invalid latitude',
            details: 'Latitude must be between -90 and 90'
        });
    }

    if (longitude < -180 || longitude > 180) {
        return res.status(400).json({
            error: 'Invalid longitude',
            details: 'Longitude must be between -180 and 180'
        });
    }

    try {
        // First check if user exists
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${userId}`
            });
        }

        const result = await pool.query(
            'INSERT INTO pings (user_id, message, mood, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
            [userId, message, mood, parseFloat(latitude), parseFloat(longitude)]
        );

        res.json({
            status: 'ok',
            message: 'Ping created successfully',
            data: {
                id: result.rows[0].id,
                userId,
                message,
                mood,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                createdAt: result.rows[0].created_at
            }
        });
    } catch (err) {
        console.error('Error creating ping:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// GET /pings/nearby
router.get('/nearby', async (req, res) => {
    const { lat, lng, radius } = req.query;

    // Validate input
    if (!lat || !lng || !radius) {
        return res.status(400).json({
            error: 'Missing required query parameters',
            details: {
                lat: !lat ? 'Missing latitude' : null,
                lng: !lng ? 'Missing longitude' : null,
                radius: !radius ? 'Missing radius' : null
            }
        });
    }

    // Validate numeric values
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusNum = parseFloat(radius);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusNum)) {
        return res.status(400).json({
            error: 'Invalid parameters',
            details: {
                lat: isNaN(latitude) ? 'Must be a number' : null,
                lng: isNaN(longitude) ? 'Must be a number' : null,
                radius: isNaN(radiusNum) ? 'Must be a number' : null
            }
        });
    }

    // Validate ranges
    if (latitude < -90 || latitude > 90) {
        return res.status(400).json({
            error: 'Invalid latitude',
            details: 'Latitude must be between -90 and 90'
        });
    }

    if (longitude < -180 || longitude > 180) {
        return res.status(400).json({
            error: 'Invalid longitude',
            details: 'Longitude must be between -180 and 180'
        });
    }

    if (radiusNum <= 0) {
        return res.status(400).json({
            error: 'Invalid radius',
            details: 'Radius must be greater than 0'
        });
    }

    const client = await pool.connect();
    try {
        await enablePostGISExtensions(client);

        const query = `
            SELECT 
                u.id as "userId",
                u.email,
                u.name,
                p.id as "pingId",
                p.message,
                p.mood,
                p.latitude,
                p.longitude,
                p.created_at as "createdAt"
            FROM pings p
            JOIN users u ON u.id = p.user_id
            WHERE ${createNearbyCondition('p')}
            ORDER BY p.created_at DESC;
        `;

        const result = await client.query(query, [latitude, longitude, radiusNum]);

        // Transform the results to include displayName
        const transformedResults = result.rows.map(row => ({
            ...row,
            displayName: row.name || row.email
        }));

        res.json(transformedResults);
    } catch (err) {
        console.error('Error fetching nearby pings:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } finally {
        client.release();
    }
});

module.exports = router; 