import { useState } from 'react';
import Avatar from './ui/Avatar.jsx';
import ActionBar from './ActionBar.jsx';
import BlockchainTimer from './ui/BlockchainTimer.jsx';
import CommentSection from './CommentSection.jsx';
import styles from './ConfessionCard.module.css';

function formatRelativeTime(timestamp) {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = Math.floor((now - then) / 1000);

    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

export default function ConfessionCard({ confession, currentUserId }) {
    const [showComments, setShowComments] = useState(false);
    const [localCommentCount, setLocalCommentCount] = useState(
        confession.comments_count || 0
    );
    // Decrypt content (currently just returns as-is since encryption is stubbed)
    const content = confession.encrypted_content || confession.content;
    
    return (
        <article className={styles.card}>
            <Avatar size="md" avatarIndex={confession.users?.avatar_index} />
            <div className={styles.content}>
                <div className={styles.header}>
                    <span className={styles.displayName}>{confession.users?.display_name}</span>
                    <span className={styles.username}>@{confession.users?.username}</span>
                    <span className={styles.separator}>·</span>
                    <span className={styles.time}>{formatRelativeTime(confession.created_at)}</span>
                </div>
                <p className={styles.body}>{content}</p>
                <div className={styles.timerWrapper}>
                    <BlockchainTimer 
                        uploadAt={confession.edit_window_expires_at} 
                        isOnChain={confession.is_on_chain} 
                    />
                </div>
                <ActionBar
                    confessionId={confession.id}
                    commentCount={localCommentCount}
                    currentUserId={currentUserId}
                    isOnChain={confession.is_on_chain}
                    contentHash={confession.content_hash}
                    blockchainTxHash={confession.blockchain_tx_hash}
                    decryptedContent={content}
                    onCommentClick={() => setShowComments(prev => !prev)}
                />
                {showComments && (
                    <CommentSection
                        confessionId={confession.id}
                        currentUserId={currentUserId}
                        onCommentAdded={() => 
                            setLocalCommentCount((prev) => prev + 1)
                        }
                    />
                )}
            </div>

        </article>
    );
}
