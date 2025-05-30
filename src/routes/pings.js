const express = require('express');
const router = express.Router();
const { pool, enablePostGISExtensions } = require('../config/db');
const { createNearbyCondition } = require('../utils/geo');

// Validate category helper function
const isValidCategory = (category) => ['skill', 'education', 'experience'].includes(category);

// POST /pings
router.post('/', async (req, res) => {
    const { userId, message, mood, latitude, longitude, category, value } = req.body;

    // Validate input
    if (!userId || !message || !mood || !latitude || !longitude || !category || !value) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: {
                userId: !userId ? 'Missing userId' : null,
                message: !message ? 'Missing message' : null,
                mood: !mood ? 'Missing mood' : null,
                latitude: !latitude ? 'Missing latitude' : null,
                longitude: !longitude ? 'Missing longitude' : null,
                category: !category ? 'Missing category' : null,
                value: !value ? 'Missing value' : null
            }
        });
    }

    // Validate category
    if (!isValidCategory(category)) {
        return res.status(400).json({
            error: 'Invalid category',
            details: 'Category must be one of: skill, education, experience'
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
            'INSERT INTO pings (user_id, message, mood, latitude, longitude, category, value) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at',
            [userId, message, mood, parseFloat(latitude), parseFloat(longitude), category, value]
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
                category,
                value,
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
    const { lat, lng, userId } = req.query;

    // Log incoming parameters
    console.log('GET /pings/nearby - Query params:', { lat, lng, userId });

    // Validate required parameters
    if (!lat || !lng || !userId) {
        console.log('GET /pings/nearby - Missing parameters:', {
            lat: !lat ? 'missing' : 'present',
            lng: !lng ? 'missing' : 'present',
            userId: !userId ? 'missing' : 'present'
        });
        return res.status(400).json({
            error: 'Missing or invalid lat, lng, or userId'
        });
    }

    // Validate numeric values
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
        console.log('GET /pings/nearby - Invalid numeric values:', {
            lat: isNaN(latitude) ? 'not a number' : latitude,
            lng: isNaN(longitude) ? 'not a number' : longitude
        });
        return res.status(400).json({
            error: 'Missing or invalid lat, lng, or userId'
        });
    }

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(userId)) {
        console.log('GET /pings/nearby - Invalid UUID format:', { userId });
        return res.status(400).json({
            error: 'Missing or invalid lat, lng, or userId'
        });
    }

    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90) {
        console.log('GET /pings/nearby - Invalid latitude range:', { latitude });
        return res.status(400).json({
            error: 'Missing or invalid lat, lng, or userId'
        });
    }

    if (longitude < -180 || longitude > 180) {
        console.log('GET /pings/nearby - Invalid longitude range:', { longitude });
        return res.status(400).json({
            error: 'Missing or invalid lat, lng, or userId'
        });
    }

    const client = await pool.connect();
    try {
        await enablePostGISExtensions(client);

        // Fixed 1km radius (1000 meters)
        const radiusMeters = 1000;

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
                p.category,
                p.value,
                p.created_at as "createdAt",
                earth_distance(
                    ll_to_earth(p.latitude, p.longitude),
                    ll_to_earth($1, $2)
                )::float as distance
            FROM pings p
            JOIN users u ON u.id = p.user_id
            WHERE 
                p.user_id != $3
                AND p.created_at > NOW() - INTERVAL '15 minutes'
                AND earth_distance(
                    ll_to_earth(p.latitude, p.longitude),
                    ll_to_earth($1, $2)
                )::float <= $4
            ORDER BY distance ASC, p.created_at DESC;
        `;

        const result = await client.query(query, [latitude, longitude, userId, radiusMeters]);

        // Transform the results to include displayName
        const transformedResults = result.rows.map(row => ({
            ...row,
            displayName: row.name || row.email,
            distance: Math.round(row.distance) // Round to nearest meter
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

// GET /pings/filters
router.get('/filters', async (req, res) => {
    try {
        const queries = [
            pool.query("SELECT DISTINCT item_data FROM profile_items WHERE item_type = 'skills'"),
            pool.query("SELECT DISTINCT item_data FROM profile_items WHERE item_type = 'education'"),
            pool.query("SELECT DISTINCT item_data FROM profile_items WHERE item_type = 'experience'")
        ];

        const [skillsResult, educationResult, experienceResult] = await Promise.all(queries);

        res.json({
            skills: skillsResult.rows.map(row => row.item_data),
            education: educationResult.rows.map(row => row.item_data),
            experience: experienceResult.rows.map(row => row.item_data)
        });
    } catch (err) {
        console.error('Error fetching filters:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

module.exports = router; 