-- ============================================================================
-- CHAT FEATURE MIGRATION — run on top of your existing schema
-- ============================================================================


-- ========================
-- TABLES
-- ========================

CREATE TABLE chat_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    is_matched BOOLEAN DEFAULT FALSE,
    UNIQUE (user_id)
);

CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_a_public_key TEXT,
    user_b_public_key TEXT,
    verification_hash TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
-- RLS
-- ========================

ALTER TABLE chat_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_queue_insert_own" ON chat_queue FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "chat_queue_select_own" ON chat_queue FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "chat_queue_update_own" ON chat_queue FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "chat_queue_delete_own" ON chat_queue FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "chat_sessions_select_participant" ON chat_sessions FOR SELECT TO authenticated USING (user_a = auth.uid() OR user_b = auth.uid());
CREATE POLICY "chat_sessions_update_participant" ON chat_sessions FOR UPDATE TO authenticated USING (user_a = auth.uid() OR user_b = auth.uid());

CREATE POLICY "chat_messages_select_participant" ON chat_messages FOR SELECT TO authenticated
USING (session_id IN (SELECT id FROM chat_sessions WHERE (user_a = auth.uid() OR user_b = auth.uid()) AND is_active = TRUE));

CREATE POLICY "chat_messages_insert_own" ON chat_messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND session_id IN (SELECT id FROM chat_sessions WHERE (user_a = auth.uid() OR user_b = auth.uid()) AND is_active = TRUE));


-- ========================
-- FUNCTIONS
-- ========================

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
      AND q1.last_heartbeat > NOW() - INTERVAL '15 seconds'
      AND q2.last_heartbeat > NOW() - INTERVAL '15 seconds'
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

GRANT EXECUTE ON FUNCTION match_chat_users() TO authenticated;


CREATE OR REPLACE FUNCTION end_chat_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM chat_sessions
        WHERE id = p_session_id AND (user_a = auth.uid() OR user_b = auth.uid()) AND is_active = TRUE
    ) THEN RETURN FALSE; END IF;

    DELETE FROM chat_messages WHERE session_id = p_session_id;
    UPDATE chat_sessions SET is_active = FALSE, ended_at = NOW() WHERE id = p_session_id;
    DELETE FROM chat_queue WHERE user_id IN (
        SELECT user_a FROM chat_sessions WHERE id = p_session_id
        UNION SELECT user_b FROM chat_sessions WHERE id = p_session_id
    );
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION end_chat_session(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION clean_stale_queue()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE cleaned INTEGER;
BEGIN
    DELETE FROM chat_queue WHERE last_heartbeat < NOW() - INTERVAL '30 seconds' AND is_matched = FALSE;
    GET DIAGNOSTICS cleaned = ROW_COUNT;
    RETURN cleaned;
END;
$$;

GRANT EXECUTE ON FUNCTION clean_stale_queue() TO authenticated;


-- ========================
-- INDEXES
-- ========================

CREATE INDEX idx_chat_queue_unmatched ON chat_queue(is_matched, last_heartbeat DESC) WHERE is_matched = FALSE;
CREATE INDEX idx_chat_sessions_active ON chat_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);