import { useState, useEffect } from 'react';
import { supabase } from '../config/supabase.js';
import { verifyIntegrity, verifyBlockchainIntegrity } from '../security/hashIntegrity.js';
import { verifyConfessionOnChain } from '../security/blockchainService.js';
import IconButton from './ui/IconButton.jsx';
import { CommentIcon, UpvoteIcon, DownvoteIcon, ShieldIcon } from './ui/icons.jsx';
import styles from './ActionBar.module.css';

export default function ActionBar({
    confessionId,
    currentUserId,
    isOnChain,
    contentHash,
    blockchainTxHash,
    decryptedContent,
    onCommentClick,
    commentCount,
}) {
    const [voteCount, setVoteCount] = useState(0);
    const [userVote, setUserVote] = useState(null); // 'up' | 'down' | null
    const [verifyStatus, setVerifyStatus] = useState(null); // 'verified' | 'failed' | 'pending'

    useEffect(() => {
        fetchCounts();
        fetchUserVote();
    }, [confessionId, currentUserId]);

    const fetchCounts = async () => {
        // Vote count
        const { data: votes } = await supabase
            .from('votes')
            .select('vote_type')
            .eq('confession_id', confessionId);

        const net = (votes || []).reduce((sum, v) => sum + v.vote_type, 0);
        setVoteCount(net);
    };

    const fetchUserVote = async () => {
        const { data } = await supabase
            .from('votes')
            .select('vote_type')
            .eq('confession_id', confessionId)
            .eq('user_id', currentUserId)
            .maybeSingle();

        if (data) {
            setUserVote(data.vote_type === 1 ? 'up' : 'down');
        } else {
            setUserVote(null);
        }
    };

    const handleVote = async (type) => {
        const newVote = userVote === type ? null : type;
        const voteValue = type === 'up' ? 1 : -1;

        try {
            if (newVote === null) {
                // Remove vote
                await supabase
                    .from('votes')
                    .delete()
                    .eq('confession_id', confessionId)
                    .eq('user_id', currentUserId);
            } else {
                // Upsert vote
                await supabase.from('votes').upsert({
                    confession_id: confessionId,
                    user_id: currentUserId,
                    vote_type: voteValue,
                }, {
                    onConflict: 'user_id,confession_id'
                });
            }

            // Update local state immediately for responsive UI
            const oldVoteValue = userVote === 'up' ? 1 : userVote === 'down' ? -1 : 0;
            const newVoteValue = newVote === 'up' ? 1 : newVote === 'down' ? -1 : 0;
            setVoteCount(voteCount - oldVoteValue + newVoteValue);
            setUserVote(newVote);
        } catch (error) {
            console.error('Vote error:', error);
        }
    };

    const handleVerify = async () => {
        setVerifyStatus('pending');

        try {
            // First check local hash
            const localVerified = await verifyIntegrity(decryptedContent, contentHash);
            if (!localVerified) {
                setVerifyStatus('failed');
                return;
            }

            // Verify against blockchain
            const result = await verifyConfessionOnChain(confessionId, contentHash);

            if (!result.onChain) {
                // Not yet on blockchain — still within edit window or not opted in
                setVerifyStatus('pending');
            } else if (result.verified) {
                // Hash matches blockchain record
                setVerifyStatus('verified');
            } else {
                // Hash mismatch — content has been tampered with
                setVerifyStatus('failed');
            }
        } catch {
            setVerifyStatus('failed');
        }
    };

    const voteColor = voteCount > 0 ? 'var(--success)' : voteCount < 0 ? 'var(--danger)' : 'var(--text-secondary)';
    const shieldColor = verifyStatus === 'verified' ? 'var(--success)' : verifyStatus === 'failed' ? 'var(--danger)' : verifyStatus === 'pending' ? 'var(--warning)' : 'var(--text-secondary)';

    return (
        <div className={styles.actionBar}>
            <IconButton
                icon={<CommentIcon size={18} />}
                label="Comment"
                count={commentCount}
                onClick={onCommentClick}
            />

            <div className={styles.voteGroup}>
                <IconButton
                    icon={<UpvoteIcon size={18} filled={userVote === 'up'} />}
                    label="Upvote"
                    active={userVote === 'up'}
                    activeColor="var(--success)"
                    onClick={() => handleVote('up')}
                />
                <span className={styles.voteCount} style={{ color: voteColor }}>
                    {voteCount}
                </span>
                <IconButton
                    icon={<DownvoteIcon size={18} filled={userVote === 'down'} />}
                    label="Downvote"
                    active={userVote === 'down'}
                    activeColor="var(--danger)"
                    onClick={() => handleVote('down')}
                />
            </div>

            <IconButton
                icon={<ShieldIcon size={18} filled={verifyStatus === 'verified'} color={shieldColor} />}
                label="Verify"
                onClick={handleVerify}
            />
        </div>
    );
}
