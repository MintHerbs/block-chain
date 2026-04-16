-- ============================================================================
-- CHAT SQL IMPROVEMENTS (Optional but Recommended)
-- ============================================================================
-- Run these after running chat.sql to optimize the chat feature
-- These are NOT required - the chat will work without them
-- ============================================================================

-- ========================
-- 1. INCREASE HEARTBEAT TIMEOUT (Recommended)
-- ========================
-- Change from 15 seconds to 2 minutes to match frontend heartbeat interval
-- This prevents valid users from being excluded from matching

CREATE OR REPLACE FUNCTION match_chat_users()
RETURNS TABLE(session_id UUID, matched_user_a UUID, matched_user_b UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user_a UUID;
    v_user_b UUID;
    v_session_id UUID;
BEGIN
    SELECT q1.user_id, q2.user_id INTO v_user_a, v_user_b
    FROM chat_queue q1 CROSS JOIN chat_queue q2
    WHERE q1.is_matched = FALSE AND q2.is_matched = FALSE
      AND q1.user_id != q2.user_id
      AND q1.last_heartbeat > NOW() - INTERVAL '2 minutes'  -- Changed from 15 seconds
      AND q2.last_heartbeat > NOW() - INTERVAL '2 minutes'  -- Changed from 15 seconds
    ORDER BY q1.joined_at ASC, q2.joined_at ASC
    LIMIT 1;

    IF v_user_a IS NULL OR v_user_b IS NULL THEN RETURN; END IF;

    INSERT INTO chat_sessions (user_a, user_b) VALUES (v_user_a, v_user_b) RETURNING id INTO v_session_id;
    UPDATE chat_queue SET is_matched = TRUE WHERE user_id IN (v_user_a, v_user_b);

    session_id := v_session_id;
    matched_user_a := v_user_a;
    matched_user_b := v_user_b;
    RETURN NEXT;
END;
$$;

-- ========================
-- 2. INCREASE CLEANUP TIMEOUT (Recommended)
-- ========================
-- Change from 30 seconds to 2 minutes to match heartbeat interval
-- This prevents active users from being removed prematurely

CREATE OR REPLACE FUNCTION clean_stale_queue()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE cleaned INTEGER;
BEGIN
    DELETE FROM chat_queue 
    WHERE last_heartbeat < NOW() - INTERVAL '2 minutes'  -- Changed from 30 seconds
      AND is_matched = FALSE;
    GET DIAGNOSTICS cleaned = ROW_COUNT;
    RETURN cleaned;
END;
$$;

-- ========================
-- 3. ADD USER ORDERING CONSTRAINT (Optional)
-- ========================
-- Ensures user_a is always less than user_b to prevent duplicate sessions
-- This is optional but good practice

ALTER TABLE chat_sessions 
ADD CONSTRAINT check_user_order 
CHECK (user_a < user_b);

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. These changes are OPTIONAL - the chat works without them
-- 2. The timeout changes improve reliability
-- 3. The ordering constraint prevents edge cases
-- 4. You can run these at any time (even after chat is live)
-- ============================================================================
