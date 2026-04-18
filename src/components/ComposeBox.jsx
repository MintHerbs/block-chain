import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../config/supabase.js';
import { sanitizeText, validateConfession } from '../security/sanitize.js';
import { hashContent, encrypt } from '../security/hashIntegrity.js';
import { canUserPost, recordPost } from '../security/rateLimiter.js';
import Avatar from './ui/Avatar.jsx';
import Textarea from './ui/Textarea.jsx';
import Button from './ui/Button.jsx';
import styles from './ComposeBox.module.css';

export default function ComposeBox({ onPosted }) {
    const { user } = useAuth();
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [optInBlockchain, setOptInBlockchain] = useState(false);

    const handlePost = async () => {
        if (!text.trim()) return;

        setLoading(true);
        setError('');

        try {
            // Security pipeline
            const sanitized = sanitizeText(text);
            validateConfession(sanitized);
            
            // Check rate limit with graceful fallback
            try {
                await canUserPost(user.id);
            } catch (rateLimitError) {
                console.warn('Rate limit check failed, proceeding with post:', rateLimitError.message);
            }
            
            const contentHash = await hashContent(sanitized);
            const encrypted = encrypt(sanitized);

            // Set edit window based on blockchain opt-in
            // Blockchain: 2 minutes, DB-only: null (no edit window)
            const editWindowExpiresAt = optInBlockchain 
                ? new Date(Date.now() + 2 * 60 * 1000).toISOString()
                : null;
            
            const { data, error: insertError } = await supabase
                .from('confessions')
                .insert({
                    user_id: user.id,
                    encrypted_content: encrypted,
                    content_hash: contentHash,
                    opt_in_blockchain: optInBlockchain,
                    edit_window_expires_at: editWindowExpiresAt,
                    is_on_chain: false,
                })
                .select('*, users(display_name, username, avatar_index)')
                .single();

            if (insertError) throw insertError;

            recordPost(user.id);
            setText('');
            setOptInBlockchain(false);
            if (onPosted) onPosted(data);
        } catch (err) {
            setError(err.message || 'Failed to post confession');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.composeBox}>
            <Avatar size="md" avatarIndex={user?.avatar_index} />
            <div className={styles.content}>
                <Textarea
                    placeholder="What's happening?"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={5000}
                    rows={3}
                    autoGrow
                    disabled={loading}
                />
                <label className={styles.blockchainToggle}>
                    <input
                        type="checkbox"
                        checked={optInBlockchain}
                        onChange={(e) => setOptInBlockchain(e.target.checked)}
                        disabled={loading}
                        className={styles.checkbox}
                    />
                    <span className={styles.checkboxLabel}>Add to blockchain</span>
                    <span className={styles.helperText}>
                        Confessions on blockchain cannot be edited after 2 minutes
                    </span>
                </label>
                <div className={styles.footer}>
                    <span className={styles.charCount}>
                        {text.length}/5000
                    </span>
                    <Button
                        variant="primary"
                        size="md"
                        disabled={!text.trim() || loading}
                        loading={loading}
                        onClick={handlePost}
                    >
                        Post
                    </Button>
                </div>
                {error && <p className={styles.error}>{error}</p>}
            </div>
        </div>
    );
}
