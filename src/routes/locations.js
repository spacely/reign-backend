const express = require('express');
const router = express.Router();
const { pool, enablePostGISExtensions } = require('../config/db');
const { createNearbyCondition } = require('../utils/geo');

// POST /locations
router.post('/', async (req, res) => {
    const { userId, lat, lng } = req.body;

    // Validate input types and ranges
    if (!userId || !lat || !lng) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: {
                userId: !userId ? 'Missing userId' : null,
                lat: !lat ? 'Missing latitude' : null,
                lng: !lng ? 'Missing longitude' : null
            }
        });
    }

    // Validate latitude and longitude ranges
    if (lat < -90 || lat > 90) {
        return res.status(400).json({
            error: 'Invalid latitude',
            details: 'Latitude must be between -90 and 90'
        });
    }

    if (lng < -180 || lng > 180) {
        return res.status(400).json({
            error: 'Invalid longitude',
            details: 'Longitude must be between -180 and 180'
        });
    }

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(userId)) {
        return res.status(400).json({
            error: 'Invalid userId',
            details: 'userId must be a valid UUID'
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

        // Update or insert location using exact specified query
        const result = await pool.query(
            `INSERT INTO locations (user_id, latitude, longitude, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id) DO UPDATE
             SET latitude = EXCLUDED.latitude,
                 longitude = EXCLUDED.longitude,
                 created_at = NOW()
             RETURNING user_id, latitude, longitude, created_at`,
            [userId, parseFloat(lat), parseFloat(lng)]
        );

        res.json({
            status: 'ok',
            message: 'Location saved successfully',
            data: {
                userId: result.rows[0].user_id,
                latitude: result.rows[0].latitude,
                longitude: result.rows[0].longitude,
                updatedAt: result.rows[0].created_at
            }
        });
    } catch (err) {
        console.error('Error saving location:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// GET /locations/nearby
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
                l.latitude,
                l.longitude,
                l.created_at as "locationUpdatedAt",
                us.last_seen as "lastSeen",
                us.is_broadcasting as "isBroadcasting"
            FROM locations l
            JOIN users u ON u.id = l.user_id
            JOIN user_status us ON u.id = us.user_id
            WHERE ${createNearbyCondition('l')}
            AND us.is_broadcasting = true
            AND us.last_seen > NOW() - INTERVAL '3 minutes'
            ORDER BY l.created_at DESC;
        `;

        const result = await client.query(query, [latitude, longitude, radiusNum]);

        // Transform the results to include displayName
        const transformedResults = result.rows.map(row => ({
            ...row,
            displayName: row.name || row.email
        }));

        res.json(transformedResults);
    } catch (err) {
        console.error('Error fetching nearby locations:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } finally {
        client.release();
    }
});

module.exports = router; 