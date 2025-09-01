# Reign Backend API Documentation

## Overview

The Reign Backend is a Node.js/Express.js API service designed for a location-based social networking mobile application. It provides user management, real-time location sharing, proximity-based social features, and peer validation capabilities.

## Architecture

### Technology Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.18+
- **Database**: PostgreSQL with PostGIS extensions
- **Security**: Helmet middleware, CORS enabled
- **Environment**: Docker containerized, Railway deployment ready

### Core Features
- **User Profiles**: Registration, profile management with custom items
- **Location Services**: Real-time location tracking with geospatial queries
- **Social Networking**: User connections and proximity-based discovery
- **Pings**: Location-based mood/skill broadcasting
- **Validation System**: Peer-to-peer profile validation
- **Real-time Proximity**: Find nearby users within customizable radius

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Profile Items Table
```sql
CREATE TABLE profile_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type VARCHAR(50) NOT NULL,
    item_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Locations Table
```sql
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Pings Table
```sql
CREATE TABLE pings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    mood TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    category TEXT CHECK (category IN ('skill', 'education', 'experience')),
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### Health & Status

#### GET /health
Health check endpoint for monitoring service availability.

**Response:**
```json
{
  "status": "ok"
}
```

#### GET /
Welcome endpoint with service information.

**Response:**
```json
{
  "message": "Welcome to Reign backend service",
  "version": "1.0.0"
}
```

### User Profiles

#### POST /profiles
Create a new user profile.

**Request Body:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "profileItems": [
    {
      "type": "skill",
      "data": {"skill": "JavaScript", "level": "Expert"}
    },
    {
      "type": "education", 
      "data": {"degree": "Computer Science", "institution": "MIT"}
    }
  ],
  "profileImageData": "data:image/jpeg;base64,..."
}
```

**Response (201):**
```json
{
  "status": "ok",
  "message": "Profile created successfully",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "profileItems": [...],
    "profileImage": "data:image/jpeg;base64,..."
  }
}
```

**Error Responses:**
- `400` - Missing/invalid fields
- `409` - Email already exists

#### GET /profiles/:id
Retrieve user profile by ID.

**Response (200):**
```json
{
  "userId": "uuid",
  "email": "user@example.com", 
  "name": "John Doe",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "profileItems": [
    {
      "id": "uuid",
      "itemType": "skill",
      "itemData": {"skill": "JavaScript", "level": "Expert"},
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "profileImage": "data:image/jpeg;base64,...",
  "location": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "lastPing": {
    "mood": "happy",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `404` - User not found

#### GET /profiles/by-email/:email
Retrieve user profile by email address.

**Response:** Same as GET /profiles/:id

#### PUT /profiles/:id
Update user profile.

**Request Body:**
```json
{
  "name": "Updated Name",
  "email": "new@example.com",
  "profileItems": [...],
  "profileImageData": "data:image/jpeg;base64,..."
}
```

**Response (200):**
```json
{
  "status": "ok",
  "message": "Profile updated successfully",
  "data": {
    "user": {...},
    "profileItems": [...],
    "profileImage": "..."
  }
}
```

### Location Services

#### POST /locations
Update user's current location.

**Request Body:**
```json
{
  "userId": "uuid",
  "lat": 40.7128,
  "lng": -74.0060
}
```

**Response (200):**
```json
{
  "status": "ok",
  "message": "Location saved successfully",
  "data": {
    "userId": "uuid",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `400` - Missing/invalid parameters
- `404` - User not found

#### GET /locations/nearby
Find nearby users within specified radius.

**Query Parameters:**
- `lat` (required): Latitude
- `lng` (required): Longitude  
- `radius` (required): Radius in kilometers

**Response (200):**
```json
[
  {
    "userId": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "displayName": "John Doe",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "locationUpdatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### Pings (Location-Based Broadcasting)

#### POST /pings
Create a new ping to broadcast mood/skill at current location.

**Request Body:**
```json
{
  "userId": "uuid",
  "message": "Looking for JavaScript developers!",
  "mood": "excited",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "category": "skill",
  "value": "JavaScript"
}
```

**Response (200):**
```json
{
  "status": "ok",
  "message": "Ping created successfully",
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "message": "Looking for JavaScript developers!",
    "mood": "excited",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "category": "skill",
    "value": "JavaScript",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Validation:**
- `category` must be one of: skill, education, experience
- `latitude` must be between -90 and 90
- `longitude` must be between -180 and 180

#### GET /pings/nearby
Find nearby pings within 1km radius (last 15 minutes).

**Query Parameters:**
- `lat` (required): Latitude
- `lng` (required): Longitude
- `userId` (required): Current user ID
- `mood` (optional): Filter by mood
- `skill` (optional): Filter by skill value
- `education` (optional): Filter by education value
- `experience` (optional): Filter by experience value

**Response (200):**
```json
[
  {
    "userId": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "displayName": "John Doe",
    "pingId": "uuid",
    "message": "Looking for JavaScript developers!",
    "mood": "excited",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "category": "skill",
    "value": "JavaScript",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "distance": 150
  }
]
```

#### GET /pings/filters
Get available filter options from profile items.

**Response (200):**
```json
{
  "skills": [
    {"skill": "JavaScript", "level": "Expert"},
    {"skill": "Python", "level": "Intermediate"}
  ],
  "education": [
    {"degree": "Computer Science", "institution": "MIT"}
  ],
  "experience": [
    {"company": "Google", "role": "Software Engineer"}
  ]
}
```

### Social Connections

#### POST /connect
Create a connection between two users.

**Request Body:**
```json
{
  "fromUser": "uuid",
  "toUser": "uuid"
}
```

**Response (200):**
```json
{
  "status": "ok",
  "message": "Connected successfully"
}
```

**Error Responses:**
- `400` - Invalid user IDs or self-connection
- `404` - User not found

#### GET /connections/:userId
Get all connections for a user.

**Response (200):**
```json
[
  "uuid1",
  "uuid2",
  "uuid3"
]
```

### Validation System

#### GET /validation/nearby
Find nearby connected users available for validation (within 3 meters).

**Query Parameters:**
- `lat` (required): Latitude
- `lng` (required): Longitude
- `userId` (required): Current user ID
- `radius` (optional): Search radius in degrees (default: 0.01)

**Response (200):**
```json
[
  {
    "userId": "uuid",
    "name": "John Doe",
    "email": "user@example.com",
    "displayName": "John Doe",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "distance": 2,
    "profileItems": [...],
    "connectionState": "connected",
    "validationCount": 5
  }
]
```

#### POST /validation/request
Send a validation request to another user.

**Request Body:**
```json
{
  "fromUserId": "uuid",
  "toUserId": "uuid", 
  "category": "skills",
  "specificItem": "JavaScript"
}
```

**Response (201):**
```json
{
  "requestId": "uuid",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "message": "Validation request sent successfully"
}
```

**Requirements:**
- Users must be connected
- Users must be within 3 meters
- Category must be one of: skills, education, experience
- Specific item must exist in target user's profile

#### POST /validation/respond
Respond to a validation request.

**Request Body:**
```json
{
  "requestId": "uuid",
  "response": "approved"
}
```

**Response (200):**
```json
{
  "message": "Validation request approved successfully"
}
```

**Valid responses:** `approved`, `declined`

#### GET /validation/pending/:userId
Get pending validation requests for a user.

**Response (200):**
```json
[
  {
    "id": "uuid",
    "fromUserId": "uuid",
    "category": "skills",
    "specificItem": "JavaScript",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "expiresAt": "2024-01-02T00:00:00.000Z",
    "requesterName": "John Doe",
    "requesterEmail": "john@example.com"
  }
]
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error type",
  "details": "Detailed error message"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `404` - Not Found
- `409` - Conflict (duplicates)
- `422` - Unprocessable Entity (business logic errors)
- `500` - Internal Server Error

## Rate Limiting & Security

- CORS enabled for cross-origin requests
- Helmet middleware for security headers
- Input validation for all endpoints
- UUID format validation
- Coordinate range validation
- SQL injection protection via parameterized queries

## Development Notes

- All coordinates use decimal degrees format
- Distance calculations use PostGIS earthdistance extension
- Ping visibility limited to last 15 minutes
- Validation requires users to be within 3 meters
- Profile images limited to 2MB JPEG format
- Database uses UUID primary keys throughout