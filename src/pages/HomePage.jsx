import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../config/supabase.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import ComposeBox from '../components/ComposeBox.jsx';
import ConfessionFeed from '../components/ConfessionFeed.jsx';
import BlockchainGraph from '../components/BlockchainGraph.jsx';
import styles from './HomePage.module.css';

export default function HomePage() {
    const { user } = useAuth();
    const { blockchainRecords } = useOutletContext();
    const [confessions, setConfessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [isBlockchainOpen, setIsBlockchainOpen] = useState(false);
    const [highlightConfessionId, setHighlightConfessionId] = useState(null);
    const [stats, setStats] = useState({ total: 0, onChain: 0 });
    const [showWelcome, setShowWelcome] = useState(true);
    const [showScrollTop, setShowScrollTop] = useState(false);

    useEffect(() => {
        fetchConfessions();
        fetchStats();
        
        // Hide welcome banner after first visit
        const hasVisited = localStorage.getItem('hasVisitedHome');
        if (hasVisited) {
            setShowWelcome(false);
        } else {
            localStorage.setItem('hasVisitedHome', 'true');
        }

        // Scroll to top button
        const handleScroll = () => {
            setShowScrollTop(window.scrollY > 400);
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const fetchStats = async () => {
        const { count: totalCount } = await supabase
            .from('confessions')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false);

        const { count: onChainCount } = await supabase
            .from('confessions')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false)
            .eq('is_on_chain', true);

        setStats({
            total: totalCount || 0,
            onChain: onChainCount || 0
        });
    };



    const fetchConfessions = async (offset = 0) => {
        setLoading(true);

        const { data, error } = await supabase
            .from('confessions')
            .select('*, users(display_name, username, avatar_index)')
            .eq('is_deleted', false)
            .eq('is_hidden', false)
            .order('created_at', { ascending: false })
            .range(offset, offset + 49);

        if (error) {
            console.error('Error fetching confessions:', error);
        }

        console.log('Confessions query result:', { data, error, dataLength: data?.length });

        if (!error && data) {
            const confessionIds = data.map((c) => c.id);

            let commentCountsMap = {};

            if (confessionIds.length > 0) {
                const { data: commentsData, error: commentsError } = await supabase
                    .from('comments')
                    .select('confession_id')
                    .in('confession_id', confessionIds);

                if (!commentsError && commentsData) {
                    commentCountsMap = commentsData.reduce((acc, comment) => {
                        acc[comment.confession_id] = (acc[comment.confession_id] || 0) + 1;
                        return acc;
                    }, {});
                }
            }

            const confessionsWithCounts = data.map((confession) => ({
                ...confession,
                comments_count: commentCountsMap[confession.id] || 0,
            }));

            if (offset === 0) {
                setConfessions(confessionsWithCounts);
            } else {
                setConfessions((prev) => [...prev, ...confessionsWithCounts]);
            }

            setHasMore(data.length === 50);
        }

        setLoading(false);
    };

    const handlePosted = (newConfession) => {
        // Add the new confession to the top of the feed immediately
        setConfessions((prev) => [{
             ...newConfession,
             comments_count: 0 },
              ...prev
            ]);
        // Update stats
        setStats(prev => ({ ...prev, total: prev.total + 1 }));
    };

    const handleLoadMore = () => {
        fetchConfessions(confessions.length);
    };

    const handleOpenBlockchain = async (confessionId) => {
        setHighlightConfessionId(confessionId);
        setIsBlockchainOpen(true);
    };

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className={styles.container}>
            <PageHeader title="Home" />
            
            {showWelcome && (
                <div className={styles.welcomeBanner}>
                    <div className={styles.welcomeContent}>
                        <h2 className={styles.welcomeTitle}>
                            <span className={styles.welcomeEmoji}>👋</span>
                            Welcome back, {user?.display_name}
                        </h2>
                        <p className={styles.welcomeText}>
                            Share your thoughts anonymously or make them permanent on the blockchain. 
                            Your confessions, your choice.
                        </p>
                        <div className={styles.statsBar}>
                            <div className={styles.stat}>
                                <span className={styles.statValue}>{stats.total}</span>
                                <span className={styles.statLabel}>Confessions</span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statValue}>{stats.onChain}</span>
                                <span className={styles.statLabel}>On Chain</span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statValue}>
                                    {stats.total > 0 ? Math.round((stats.onChain / stats.total) * 100) : 0}%
                                </span>
                                <span className={styles.statLabel}>Permanent</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.composeWrapper}>
                <ComposeBox onPosted={handlePosted} />
            </div>

            {loading && confessions.length === 0 ? (
                <div>
                    {[1, 2, 3].map((i) => (
                        <div key={i} className={styles.loadingShimmer}>
                            <div className={styles.shimmerCard}>
                                <div className={styles.shimmerAvatar} />
                                <div className={styles.shimmerContent}>
                                    <div className={`${styles.shimmerLine} ${styles.shimmerLineShort}`} />
                                    <div className={`${styles.shimmerLine} ${styles.shimmerLineMedium}`} />
                                    <div className={styles.shimmerLine} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : confessions.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>✨</div>
                    <h3 className={styles.emptyTitle}>No confessions yet</h3>
                    <p className={styles.emptyText}>
                        Be the first to share something. Your confession could inspire others.
                    </p>
                </div>
            ) : (
                <div className={styles.feedWrapper}>
                    <ConfessionFeed
                        confessions={confessions}
                        currentUserId={user?.id}
                        loading={loading}
                        onLoadMore={handleLoadMore}
                        hasMore={hasMore}
                        onOpenBlockchain={handleOpenBlockchain}
                    />
                </div>
            )}

            {isBlockchainOpen && (
                <BlockchainGraph
                    isOpen={isBlockchainOpen}
                    onClose={() => {
                        setIsBlockchainOpen(false);
                        setHighlightConfessionId(null);
                    }}
                    initialRecords={blockchainRecords}
                    highlightEntityId={highlightConfessionId}
                />
            )}

            <button 
                className={`${styles.scrollToTop} ${showScrollTop ? styles.visible : ''}`}
                onClick={scrollToTop}
                aria-label="Scroll to top"
            >
                ↑
            </button>
        </div>
    );
}
