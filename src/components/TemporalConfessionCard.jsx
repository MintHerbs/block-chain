import Avatar from './ui/Avatar.jsx';
import Badge from './ui/Badge.jsx';
import ActionBar from './ActionBar.jsx';
import styles from './TemporalConfessionCard.module.css';

function formatRelativeTime(timestamp) {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = Math.floor((now - then) / 1000);

    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

export default function TemporalConfessionCard({ confession, originalVersion, currentUserId }) {
    const isDeleted = confession.is_deleted;
    const content = confession.encrypted_content || confession.content;

    return (
        <div>
            <article className={`${styles.card} ${isDeleted ? styles.deleted : ''}`}>
                <Avatar size="md" avatarIndex={confession.users?.avatar_index} />
                <div className={styles.content}>
                    <div className={styles.header}>
                        <span className={styles.displayName}>{confession.users?.display_name}</span>
                        <span className={styles.username}>@{confession.users?.username}</span>
                        <span className={styles.separator}>·</span>
                        <span className={styles.time}>{formatRelativeTime(confession.created_at)}</span>
                        {isDeleted && <Badge variant="danger">Deleted</Badge>}
                    </div>
                    <p className={styles.body}>{content}</p>
                    {!isDeleted && (
                        <ActionBar
                            confessionId={confession.id}
                            currentUserId={currentUserId}
                            isOnChain={confession.is_on_chain}
                            contentHash={confession.content_hash}
                            blockchainTxHash={confession.blockchain_tx_hash}
                            decryptedContent={content}
                        />
                    )}
                </div>
            </article>

            {originalVersion && (
                <article className={`${styles.card} ${styles.original}`}>
                    <Avatar size="md" avatarIndex={confession.users?.avatar_index} />
                    <div className={styles.content}>
                        <div className={styles.header}>
                            <Badge variant="danger">Original version</Badge>
                            <span className={styles.time}>{formatRelativeTime(originalVersion.edited_at)}</span>
                        </div>
                        <p className={styles.body}>{originalVersion.previous_encrypted_content}</p>
                        <p className={styles.blockchainNote}>
                            Blockchain verification pending — awaiting integration
                        </p>
                    </div>
                </article>
            )}
        </div>
    );
}
