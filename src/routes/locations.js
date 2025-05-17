const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// POST /locations
router.post('/', async (req, res) => {
    const { userId, lat, lng } = req.body;

    // Validate input
    if (!userId || !lat || !lng) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // TODO: Replace with actual database query
        /* 
        await pool.query(
            'INSERT INTO locations (user_id, latitude, longitude) VALUES ($1, $2, $3)',
            [userId, lat, lng]
        );
        */

        res.json({
            status: 'ok',
            message: 'Location saved successfully',
            data: { userId, lat, lng }
        });
    } catch (err) {
        console.error('Error saving location:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 