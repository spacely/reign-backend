-- Migration: Create validation system tables
-- This migration creates the tables needed for user connections and validation system

-- Create connections table if it doesn't exist
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user UUID NOT NULL,
    to_user UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'connected' CHECK (status IN ('connected', 'pending', 'blocked')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT connections_from_user_fkey FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT connections_to_user_fkey FOREIGN KEY (to_user) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_connection UNIQUE (from_user, to_user),
    CONSTRAINT no_self_connection CHECK (from_user != to_user)
);

-- Create mood_badges table if it doesn't exist
CREATE TABLE IF NOT EXISTS mood_badges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    mood VARCHAR(50) NOT NULL,
    category VARCHAR(50) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mood_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create validation_requests table
CREATE TABLE IF NOT EXISTS validation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID NOT NULL,
    to_user_id UUID NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('skills', 'education', 'experience')),
    specific_item TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'expired')),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT validation_requests_from_user_fkey FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT validation_requests_to_user_fkey FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_validation_request UNIQUE (from_user_id, to_user_id, category, specific_item),
    CONSTRAINT no_self_validation CHECK (from_user_id != to_user_id)
);

-- Create validation_records table
CREATE TABLE IF NOT EXISTS validation_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    validated_user_id UUID NOT NULL,
    validator_user_id UUID NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('skills', 'education', 'experience')),
    specific_item TEXT NOT NULL,
    validation_request_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT validation_records_validated_user_fkey FOREIGN KEY (validated_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT validation_records_validator_user_fkey FOREIGN KEY (validator_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT validation_records_request_fkey FOREIGN KEY (validation_request_id) REFERENCES validation_requests(id) ON DELETE SET NULL,
    CONSTRAINT unique_validation_record UNIQUE (validated_user_id, validator_user_id, category, specific_item),
    CONSTRAINT no_self_validation_record CHECK (validated_user_id != validator_user_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_connections_from_user ON connections(from_user);
CREATE INDEX IF NOT EXISTS idx_connections_to_user ON connections(to_user);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);

CREATE INDEX IF NOT EXISTS idx_mood_badges_user_id ON mood_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_mood_badges_category ON mood_badges(category);

CREATE INDEX IF NOT EXISTS idx_validation_requests_from_user ON validation_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_validation_requests_to_user ON validation_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_validation_requests_status ON validation_requests(status);
CREATE INDEX IF NOT EXISTS idx_validation_requests_expires ON validation_requests(expires_at);

CREATE INDEX IF NOT EXISTS idx_validation_records_validated_user ON validation_records(validated_user_id);
CREATE INDEX IF NOT EXISTS idx_validation_records_validator_user ON validation_records(validator_user_id);
CREATE INDEX IF NOT EXISTS idx_validation_records_category ON validation_records(category);

-- Add comments for documentation
COMMENT ON TABLE connections IS 'Stores user-to-user connections with status tracking';
COMMENT ON TABLE mood_badges IS 'Stores user mood badges with category and value information';
COMMENT ON TABLE validation_requests IS 'Stores pending validation requests between connected users';
COMMENT ON TABLE validation_records IS 'Stores completed validations of user profile items'; 