-- ============================================================================
-- CONFESSION PLATFORM — COMPLETE DATABASE
-- This file represents the full current state of the database.
-- Run this ONLY on a fresh Supabase project (it drops everything first).
-- ============================================================================


-- ========================
-- DROP EXISTING TABLES
-- ========================

DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS chat_queue CASCADE;
DROP TABLE IF EXISTS confession_edits CASCADE;
DROP TABLE IF EXISTS blockchain_sync_log CASCADE;
DROP TABLE IF EXISTS temporal_records CASCADE;
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS confessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;


-- ============================================================================
-- TABLES
-- ============================================================================

-- ========================
-- 1. USERS
-- ========================
-- Mirrored to blockchain at signup.
-- Deleting a user row cascades to all their confessions, comments, votes, chat data.

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(50) UNIQUE NOT NULL,
    display_name        VARCHAR(100) NOT NULL,
    bio                 VARCHAR(300),
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    dh_public_key       TEXT NOT NULL,               -- Diffie-Hellman public key (stub: 'dh_placeholder')
    blockchain_tx_hash  TEXT,                        -- TX hash of on-chain user record
    is_burned           BOOLEAN DEFAULT FALSE,
    burned_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
-- 2. CONFESSIONS
-- ========================
-- Core content table. Soft-delete via is_deleted.
-- Blockchain opt-in writes hash on-chain after 2-minute edit window.
-- Panic button hides confessions from feed without deleting.
-- Expiry timer auto-deletes after set time (DB-only confessions only).
-- Content warning allows poster to flag sensitive content.

CREATE TABLE confessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_content       TEXT NOT NULL,
    content_hash            TEXT NOT NULL,           -- SHA-256 hash of plaintext, for integrity verification
    blockchain_tx_hash      TEXT,                    -- Populated after on-chain write
    is_on_chain             BOOLEAN DEFAULT FALSE,
    opt_in_blockchain       BOOLEAN DEFAULT FALSE,   -- User chose to write to blockchain
    edit_window_expires_at  TIMESTAMPTZ,             -- NULL for DB-only; created_at + 2min for blockchain
    is_deleted              BOOLEAN DEFAULT FALSE,
    deleted_at              TIMESTAMPTZ,
    is_hidden               BOOLEAN DEFAULT FALSE,   -- Panic button: hides from feed without deleting
    expires_at              TIMESTAMPTZ DEFAULT NULL, -- Self-destruct timer (DB-only confessions only)
    content_warning         VARCHAR(50) DEFAULT NULL  -- Poster-set sensitivity label
        CHECK (content_warning IN ('Mental Health', 'Violence', 'Politics', 'NSFW', 'Sensitive')),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
-- 3. COMMENTS
-- ========================
-- Comments are mirrored to blockchain.
-- Cascade delete when parent confession or user is deleted.

CREATE TABLE comments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    confession_id       UUID REFERENCES confessions(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_content   TEXT NOT NULL,
    content_hash        TEXT NOT NULL,
    blockchain_tx_hash  TEXT,
    is_on_chain         BOOLEAN DEFAULT FALSE,
    is_deleted          BOOLEAN DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
-- 4. VOTES
-- ========================
-- DB only — never written to blockchain.
-- One vote per user per confession enforced by UNIQUE constraint.
-- vote_type: 1 = upvote, -1 = downvote.

CREATE TABLE votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    confession_id   UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
    vote_type       SMALLINT NOT NULL CHECK (vote_type IN (-1, 1)),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, confession_id)
);


-- ========================
-- 5. BLOCKCHAIN SYNC LOG
-- ========================
-- Audit trail for all on-chain writes.
-- Written by the app after a successful blockchain transaction.

CREATE TABLE blockchain_sync_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'confession', 'comment')),
    entity_id   UUID NOT NULL,
    tx_hash     TEXT NOT NULL,
    block_number BIGINT,
    synced_at   TIMESTAMPTZ DEFAULT NOW(),
    status      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed'))
);


-- ========================
-- 6. TEMPORAL RECORDS
-- ========================
-- Ghost profiles of burned accounts.
-- Populated during the BURN transaction BEFORE the user row is deleted.
-- Allows Temporal search to find burned usernames and link to blockchain.

CREATE TABLE temporal_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_user_id    UUID NOT NULL,               -- Preserved even after user row is deleted
    username            VARCHAR(50) NOT NULL,
    display_name        VARCHAR(100) NOT NULL,
    blockchain_tx_hash  TEXT,
    burned_at           TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
-- 7. CONFESSION EDITS
-- ========================
-- Tracks content changes within the 2-minute edit window.
-- Used by the Temporal/profile view to show original vs edited versions.
-- previous_content_hash allows blockchain verification of original content.

CREATE TABLE confession_edits (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    confession_id               UUID NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
    previous_encrypted_content  TEXT NOT NULL,
    previous_content_hash       TEXT NOT NULL,
    edited_at                   TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
-- 8. CHAT QUEUE
-- ========================
-- Users waiting to be matched for anonymous chat.
-- Heartbeat keeps the entry alive. Stale entries cleaned by clean_stale_queue().
-- UNIQUE constraint ensures one queue entry per user at a time.

CREATE TABLE chat_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_heartbeat  TIMESTAMPTZ DEFAULT NOW(),
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    is_matched      BOOLEAN DEFAULT FALSE,
    UNIQUE (user_id)
);


-- ========================
-- 9. CHAT SESSIONS
-- ========================
-- Active anonymous chat session between two users.
-- ECDH public keys stored here for key exchange and verification code derivation.
-- Messages destroyed when session ends (end_chat_session function).

CREATE TABLE chat_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_a_public_key   TEXT,                        -- ECDH P-256 public key (base64)
    user_b_public_key   TEXT,                        -- ECDH P-256 public key (base64)
    verification_hash   TEXT,                        -- SHA-512 of shared secret → emoji + words display
    is_active           BOOLEAN DEFAULT TRUE,
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    ended_at            TIMESTAMPTZ
);


-- ========================
-- 10. CHAT MESSAGES
-- ========================
-- Encrypted messages within a chat session.
-- AES-256-GCM encrypted with session key derived from ECDH shared secret.
-- ALL messages deleted when end_chat_session() is called.

CREATE TABLE chat_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_content   TEXT NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE confessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE confession_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;


-- ── USERS ──────────────────────────────────────────────────────────────────

CREATE POLICY "users_select_authenticated"
ON users FOR SELECT TO authenticated USING (true);

CREATE POLICY "users_insert_own"
ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "users_update_own"
ON users FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "users_delete_own"
ON users FOR DELETE TO authenticated USING (id = auth.uid());


-- ── CONFESSIONS ────────────────────────────────────────────────────────────

-- Anyone logged in can read non-deleted, non-hidden confessions
CREATE POLICY "confessions_select_all"
ON confessions FOR SELECT TO authenticated USING (true);

CREATE POLICY "confessions_insert_own"
ON confessions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Edit allowed if:
--   DB-only confessions: anytime
--   Blockchain confessions: only within 2-minute edit window before going on-chain
CREATE POLICY "confessions_update_own"
ON confessions FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
    user_id = auth.uid()
    AND (
        opt_in_blockchain = FALSE
        OR (opt_in_blockchain = TRUE AND edit_window_expires_at > NOW() AND is_on_chain = FALSE)
    )
);

CREATE POLICY "confessions_delete_own"
ON confessions FOR DELETE TO authenticated
USING (
    user_id = auth.uid()
    AND (
        opt_in_blockchain = FALSE
        OR (opt_in_blockchain = TRUE AND edit_window_expires_at > NOW() AND is_on_chain = FALSE)
    )
);


-- ── COMMENTS ───────────────────────────────────────────────────────────────

CREATE POLICY "comments_select_all"
ON comments FOR SELECT TO authenticated USING (true);

CREATE POLICY "comments_insert_own"
ON comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "comments_delete_own"
ON comments FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ── VOTES ──────────────────────────────────────────────────────────────────

CREATE POLICY "votes_select_all"
ON votes FOR SELECT TO authenticated USING (true);

CREATE POLICY "votes_insert_own"
ON votes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "votes_update_own"
ON votes FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "votes_delete_own"
ON votes FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ── BLOCKCHAIN SYNC LOG ────────────────────────────────────────────────────

-- Clients can read the audit log (transparency)
-- Only service_role (backend) can write — no client INSERT policy
CREATE POLICY "sync_log_select_authenticated"
ON blockchain_sync_log FOR SELECT TO authenticated USING (true);


-- ── TEMPORAL RECORDS ───────────────────────────────────────────────────────

-- Clients can search temporal records
-- Only service_role writes (via BURN Edge Function)
CREATE POLICY "temporal_select_authenticated"
ON temporal_records FOR SELECT TO authenticated USING (true);


-- ── CONFESSION EDITS ───────────────────────────────────────────────────────

-- Anyone can view edit history (needed for Temporal profile view)
-- Service_role writes when user edits a confession
CREATE POLICY "confession_edits_select_all"
ON confession_edits FOR SELECT TO authenticated USING (true);


-- ── CHAT QUEUE ─────────────────────────────────────────────────────────────

CREATE POLICY "chat_queue_insert_own"
ON chat_queue FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_queue_select_own"
ON chat_queue FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "chat_queue_update_own"
ON chat_queue FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "chat_queue_delete_own"
ON chat_queue FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ── CHAT SESSIONS ──────────────────────────────────────────────────────────

-- Only session participants can see or update their session
CREATE POLICY "chat_sessions_select_participant"
ON chat_sessions FOR SELECT TO authenticated
USING (user_a = auth.uid() OR user_b = auth.uid());

CREATE POLICY "chat_sessions_update_participant"
ON chat_sessions FOR UPDATE TO authenticated
USING (user_a = auth.uid() OR user_b = auth.uid());


-- ── CHAT MESSAGES ──────────────────────────────────────────────────────────

-- Only participants of active sessions can read messages
CREATE POLICY "chat_messages_select_participant"
ON chat_messages FOR SELECT TO authenticated
USING (
    session_id IN (
        SELECT id FROM chat_sessions
        WHERE (user_a = auth.uid() OR user_b = auth.uid())
        AND is_active = TRUE
    )
);

-- Only the sender can insert, and only into their own active session
CREATE POLICY "chat_messages_insert_own"
ON chat_messages FOR INSERT TO authenticated
WITH CHECK (
    sender_id = auth.uid()
    AND session_id IN (
        SELECT id FROM chat_sessions
        WHERE (user_a = auth.uid() OR user_b = auth.uid())
        AND is_active = TRUE
    )
);


-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- ── Rate limiting ───────────────────────────────────────────────────────────
-- Max 10 confessions per hour per user.
-- Called by the client before inserting a new confession.

CREATE OR REPLACE FUNCTION check_confession_rate_limit(posting_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE recent_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO recent_count
    FROM confessions
    WHERE user_id = posting_user_id
    AND created_at > NOW() - INTERVAL '1 hour';
    RETURN recent_count < 10;
END;
$$;

GRANT EXECUTE ON FUNCTION check_confession_rate_limit(UUID) TO authenticated;


-- ── Match two users from the chat queue ────────────────────────────────────
-- Picks two unmatched users with heartbeats within the last 15 seconds.
-- Creates a chat_sessions row and marks both users as matched.
-- Returns the session ID and both user IDs.

CREATE OR REPLACE FUNCTION match_chat_users()
RETURNS TABLE(session_id UUID, matched_user_a UUID, matched_user_b UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user_a UUID;
    v_user_b UUID;
    v_session_id UUID;
BEGIN
    SELECT q1.user_id, q2.user_id
    INTO v_user_a, v_user_b
    FROM chat_queue q1
    CROSS JOIN chat_queue q2
    WHERE q1.is_matched = FALSE
    AND q2.is_matched = FALSE
    AND q1.user_id != q2.user_id
    AND q1.last_heartbeat > NOW() - INTERVAL '15 seconds'
    AND q2.last_heartbeat > NOW() - INTERVAL '15 seconds'
    ORDER BY q1.joined_at ASC, q2.joined_at ASC
    LIMIT 1;

    IF v_user_a IS NULL OR v_user_b IS NULL THEN RETURN; END IF;

    INSERT INTO chat_sessions (user_a, user_b)
    VALUES (v_user_a, v_user_b)
    RETURNING id INTO v_session_id;

    UPDATE chat_queue SET is_matched = TRUE
    WHERE user_id IN (v_user_a, v_user_b);

    session_id := v_session_id;
    matched_user_a := v_user_a;
    matched_user_b := v_user_b;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION match_chat_users() TO authenticated;


-- ── End a chat session and destroy all messages ────────────────────────────
-- Verifies the caller is a session participant.
-- Deletes all messages, marks session inactive, removes queue entries.

CREATE OR REPLACE FUNCTION end_chat_session(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM chat_sessions
        WHERE id = p_session_id
        AND (user_a = auth.uid() OR user_b = auth.uid())
        AND is_active = TRUE
    ) THEN
        RETURN FALSE;
    END IF;

    DELETE FROM chat_messages WHERE session_id = p_session_id;

    UPDATE chat_sessions
    SET is_active = FALSE, ended_at = NOW()
    WHERE id = p_session_id;

    DELETE FROM chat_queue WHERE user_id IN (
        SELECT user_a FROM chat_sessions WHERE id = p_session_id
        UNION
        SELECT user_b FROM chat_sessions WHERE id = p_session_id
    );

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION end_chat_session(UUID) TO authenticated;


-- ── Clean stale queue entries ───────────────────────────────────────────────
-- Removes unmatched queue entries where heartbeat is older than 30 seconds.
-- Called periodically by the client when entering the chat lobby.

CREATE OR REPLACE FUNCTION clean_stale_queue()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE cleaned INTEGER;
BEGIN
    DELETE FROM chat_queue
    WHERE last_heartbeat < NOW() - INTERVAL '30 seconds'
    AND is_matched = FALSE;
    GET DIAGNOSTICS cleaned = ROW_COUNT;
    RETURN cleaned;
END;
$$;

GRANT EXECUTE ON FUNCTION clean_stale_queue() TO authenticated;


-- ── Delete expired confessions ─────────────────────────────────────────────
-- Deletes DB-only confessions whose expires_at has passed.
-- Only deletes confessions not yet on-chain (is_on_chain = FALSE).
-- Call this on a cron or periodically from the client.

CREATE OR REPLACE FUNCTION delete_expired_confessions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE deleted INTEGER;
BEGIN
    DELETE FROM confessions
    WHERE expires_at IS NOT NULL
    AND expires_at < NOW()
    AND is_on_chain = FALSE;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_expired_confessions() TO authenticated;


-- ============================================================================
-- INDEXES
-- ============================================================================

-- Confessions
CREATE INDEX idx_confessions_user_id ON confessions(user_id);
CREATE INDEX idx_confessions_created_at ON confessions(created_at DESC);
CREATE INDEX idx_confessions_not_deleted ON confessions(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX idx_confessions_not_hidden ON confessions(is_hidden) WHERE is_hidden = FALSE;
CREATE INDEX idx_confessions_opt_blockchain ON confessions(opt_in_blockchain);
CREATE INDEX idx_confessions_expires_at ON confessions(expires_at) WHERE expires_at IS NOT NULL;

-- Comments
CREATE INDEX idx_comments_confession_id ON comments(confession_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);

-- Votes
CREATE INDEX idx_votes_confession_id ON votes(confession_id);
CREATE INDEX idx_votes_user_confession ON votes(user_id, confession_id);

-- Temporal
CREATE INDEX idx_temporal_username ON temporal_records(username);

-- Blockchain sync
CREATE INDEX idx_sync_log_entity ON blockchain_sync_log(entity_type, entity_id);

-- Chat
CREATE INDEX idx_chat_queue_unmatched ON chat_queue(is_matched, last_heartbeat DESC) WHERE is_matched = FALSE;
CREATE INDEX idx_chat_sessions_active ON chat_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
