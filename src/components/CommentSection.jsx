import { useEffect, useState } from 'react';
import { supabase } from '../config/supabase.js';
import { sanitizeText } from '../security/sanitize.js'
import { hashContent } from '../security/hashIntegrity.js';
import Avatar from './ui/Avatar.jsx';
import Textarea from './ui/Textarea.jsx';
import Button from './ui/Button.jsx';
import styles from './CommentSection.module.css';

export default function CommentSection({ confessionId, currentUserId, onCommentAdded }) {
    const [comments, setComments] = useState([]);
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchComments();
    }, [confessionId]);

    const fetchComments = async () => {
        const { data, error } = await supabase
            .from('comments')
            .select('*, users(display_name, username, avatar_index)')
            .eq('confession_id', confessionId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Fetch comments error:', error);
            return;
        }

        setComments(data || []);
    };

    const handleSubmit = async () => {
        try {
            setError('');
            const cleanText = sanitizeText(text).trim();

            if (!cleanText) {
                setError('Comment cannot be empty.');
                return;
            }

            setLoading(true);

            const contentHash = await hashContent(cleanText);

            const { error } = await supabase
                .from('comments')
                .insert({
                    confession_id: confessionId,
                    user_id: currentUserId,
                    encrypted_content: cleanText,
                    content_hash: contentHash,
                });

            if (error) {
                throw error;
            }

            setText('');
            await fetchComments();

            if (onCommentAdded) {
                onCommentAdded();
            }   
            
        } catch (err) {
            console.error('Post comment error:', err);
            setError(err.message || 'Failed to post comment.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.wrapper}>
            <div className={styles.list}>
                {comments.length === 0 ? (
                    <p className={styles.empty}>No comments yet. Be the first to comment!</p>
                ) : (
                    comments.map((comment) => (
                        <div key={comment.id} className={styles.comment}>
                            <Avatar size="sm" avatarIndex={comment.users?.avatar_index} />
                            <div className={styles.commentBody}>
                                <div className={styles.meta}>
                                    <span className={styles.displayName}>
                                        {comment.users?.display_name || 'User'}
                                    </span>
                                    <span className={styles.username}>
                                        @{comment.users?.username || 'unknown'}
                                    </span>
                                </div>
                                <p className={styles.text}>{comment.encrypted_content}</p>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className={styles.form}>
                <Textarea
                    placeholder="Write a comment..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={2}
                    autoGrow
                    maxLength={500}
                    disabled={loading}
                />
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.actions}>
                    <Button onClick={handleSubmit} loading={loading}>
                        Comment
                    </Button>
                </div>
            </div>
        </div>
    );
}