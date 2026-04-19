import ConfessionCard from './ConfessionCard.jsx';
import Loader from './ui/Loader.jsx';
import Button from './ui/Button.jsx';
import styles from './ConfessionFeed.module.css';

export default function ConfessionFeed({ confessions, currentUserId, loading, onLoadMore, hasMore, onOpenBlockchain }) {
    if (loading && confessions.length === 0) {
        return (
            <div className={styles.loading}>
                <Loader size="md" />
            </div>
        );
    }

    if (confessions.length === 0) {
        return (
            <div className={styles.empty}>
                <p>No confessions yet. Be the first to share.</p>
            </div>
        );
    }

    return (
        <div className={styles.feed}>
            {confessions.map((confession) => (
                <ConfessionCard
                    key={confession.id}
                    confession={confession}
                    currentUserId={currentUserId}
                    onOpenBlockchain={onOpenBlockchain}
                />
            ))}
            {hasMore && (
                <div className={styles.loadMore}>
                    <Button
                        variant="outline"
                        onClick={onLoadMore}
                        loading={loading}
                    >
                        Load more
                    </Button>
                </div>
            )}
        </div>
    );
}
