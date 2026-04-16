-- ============================================================================
-- CHAT FEATURE — DATABASE SCHEMA
-- ============================================================================
-- Anonymous 1-on-1 encrypted chat with matchmaking queue
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ========================
-- 1. CHAT QUEUE (matchmaking)
-- ========================
CREATE TABLE IF NOT EXISTS chat_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX idx_chat_queue_user_id ON chat_queue(user_id);
CREATE INDEX idx_chat_queue_heartbeat ON chat_queue(last_heartbeat);

-- ========================
-- 2. CHAT SESSIONS (active chats)
-- ========================
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_a_public_key TEXT,
    user_b_public_key TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    CHECK (user_a < user_b)  -- Ensure consistent ordering
);

CREATE INDEX idx_chat_sessions_user_a ON chat_sessions(user_a);
CREATE INDEX idx_chat_sessions_user_b ON chat_sessions(user_b);
CREATE INDEX idx_chat_sessions_active ON chat_sessions(is_active) WHERE is_active = TRUE;

-- ========================
-- 3. CHAT MESSAGES (encrypted)
-- ========================
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);

-- ========================
-- 4. RPC FUNCTIONS
-- ========================

-- Clean stale queue entries (heartbeat older than 2 minutes)
CREATE OR REPLACE FUNCTION clean_stale_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM chat_queue
    WHERE last_heartbeat < NOW() - INTERVAL '2 minutes';
END;
$$;

GRANT EXECUTE ON FUNCTION clean_stale_queue() TO authenticated;

-- Match two users from the queue
CREATE OR REPLACE FUNCTION match_chat_users()
RETURNS TABLE (
    session_id UUID,
    matched_user_a UUID,
    matched_user_b UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_a_id UUID;
    user_b_id UUID;
    new_session_id UUID;
BEGIN
    -- Get two users from queue (excluding the caller if they're in queue)
    SELECT q1.user_id, q2.user_id
    INTO user_a_id, user_b_id
    FROM chat_queue q1
    CROSS JOIN chat_queue q2
    WHERE q1.user_id < q2.user_id
      AND q1.last_heartbeat > NOW() - INTERVAL '2 minutes'
      AND q2.last_heartbeat > NOW() - INTERVAL '2 minutes'
    ORDER BY q1.created_at, q2.created_at
    LIMIT 1;

    -- If we found a match
    IF user_a_id IS NOT NULL AND user_b_id IS NOT NULL THEN
        -- Create session
        INSERT INTO chat_sessions (user_a, user_b)
        VALUES (user_a_id, user_b_id)
        RETURNING id INTO new_session_id;

        -- Remove both users from queue
        DELETE FROM chat_queue
        WHERE user_id IN (user_a_id, user_b_id);

        -- Return the match
        RETURN QUERY
        SELECT new_session_id, user_a_id, user_b_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION match_chat_users() TO authenticated;

-- End a chat session and delete all messages
CREATE OR REPLACE FUNCTION end_chat_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Mark session as inactive
    UPDATE chat_sessions
    SET is_active = FALSE,
        ended_at = NOW()
    WHERE id = p_session_id;

    -- Delete all messages (CASCADE will handle this, but explicit is clearer)
    DELETE FROM chat_messages
    WHERE session_id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION end_chat_session(UUID) TO authenticated;

-- ========================
-- 5. ROW LEVEL SECURITY (RLS)
-- ========================

-- Enable RLS on all tables
ALTER TABLE chat_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Chat Queue Policies
CREATE POLICY "Users can insert their own queue entry"
    ON chat_queue FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own queue entry"
    ON chat_queue FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own queue entry"
    ON chat_queue FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own queue entry"
    ON chat_queue FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Chat Sessions Policies
CREATE POLICY "Users can view their own sessions"
    ON chat_sessions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Users can update their own session keys"
    ON chat_sessions FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_a OR auth.uid() = user_b);

-- Chat Messages Policies
CREATE POLICY "Users can insert messages in their sessions"
    ON chat_messages FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM chat_sessions
            WHERE id = session_id
              AND (user_a = auth.uid() OR user_b = auth.uid())
              AND is_active = TRUE
        )
    );

CREATE POLICY "Users can view messages in their sessions"
    ON chat_messages FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM chat_sessions
            WHERE id = session_id
              AND (user_a = auth.uid() OR user_b = auth.uid())
        )
    );

-- ========================
-- 6. REALTIME PUBLICATION
-- ========================
-- Enable Realtime for chat tables
-- This must be done in the Supabase Dashboard:
-- Database → Replication → Enable for: chat_sessions, chat_messages

-- Or run this SQL (if you have the right permissions):
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Messages are encrypted client-side (AES-256-GCM)
-- 2. Server never sees plaintext
-- 3. Messages are deleted when session ends
-- 4. Queue entries expire after 2 minutes of no heartbeat
-- 5. Sessions are matched FIFO (first in, first out)
-- 6. Public keys are exchanged via the session row
-- 7. Realtime must be enabled for instant updates
-- ============================================================================
