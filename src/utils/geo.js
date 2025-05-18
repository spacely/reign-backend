/**
 * Creates a PostgreSQL query condition for finding points within a radius
 * @param {number} lat - Latitude of center point
 * @param {number} lng - Longitude of center point
 * @param {number} radiusKm - Radius in kilometers
 * @returns {string} SQL condition for WHERE clause
 */
function createNearbyCondition(tableName = 'locations') {
    return `
        earth_distance(
            ll_to_earth(${tableName}.latitude, ${tableName}.longitude),
            ll_to_earth($1, $2)
        ) <= $3 * 1000
    `;
}

module.exports = {
    createNearbyCondition
}; 