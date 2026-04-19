import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../config/supabase.js';
import { storeConfessionOnChain } from '../security/blockchainService.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import ComposeBox from '../components/ComposeBox.jsx';
import ConfessionFeed from '../components/ConfessionFeed.jsx';
import BlockchainGraph from '../components/BlockchainGraph.jsx';

export default function HomePage() {
    const { user } = useAuth();
    const { blockchainRecords } = useOutletContext();
    const [confessions, setConfessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [isBlockchainOpen, setIsBlockchainOpen] = useState(false);
    const [highlightConfessionId, setHighlightConfessionId] = useState(null);

    useEffect(() => {
        fetchConfessions();
    }, []);

    useEffect(() => {
        if (!user?.id) return;

        async function processExpiredConfessions() {
            // Find confessions that opted into blockchain, haven't been written yet,
            // and whose edit window has passed — AND belong to the current user
            const { data: expired } = await supabase
                .from('confessions')
                .select('id, content_hash')
                .eq('user_id', user.id)
                .eq('opt_in_blockchain', true)
                .eq('is_on_chain', false)
                .lt('edit_window_expires_at', new Date().toISOString())
                .limit(5);   // process 5 at a time, don't spam MetaMask

            if (!expired || expired.length === 0) return;

            for (const c of expired) {
                const result = await storeConfessionOnChain(c.id, c.content_hash);

                if (result.success) {
                    await supabase
                        .from('confessions')
                        .update({
                            is_on_chain: true,
                            blockchain_tx_hash: result.txHash,
                        })
                        .eq('id', c.id);

                    await supabase
                        .from('blockchain_sync_log')
                        .insert({
                            entity_type: 'confession',
                            entity_id: c.id,
                            tx_hash: result.txHash,
                            status: 'confirmed',
                        });
                }
            }
        }

        processExpiredConfessions();
    }, [confessions, user]);

    const fetchConfessions = async (offset = 0) => {
        setLoading(true);

        const { data, error } = await supabase
            .from('confessions')
            .select('*, users(display_name, username, avatar_index)')
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .range(offset, offset + 49);

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
    };

    const handleLoadMore = () => {
        fetchConfessions(confessions.length);
    };

    const handleOpenBlockchain = async (confessionId) => {
        setHighlightConfessionId(confessionId);
        setIsBlockchainOpen(true);
    };

    return (
        <div>
            <PageHeader title="Home" />
            <ComposeBox onPosted={handlePosted} />
            <ConfessionFeed
                confessions={confessions}
                currentUserId={user?.id}
                loading={loading}
                onLoadMore={handleLoadMore}
                hasMore={hasMore}
                onOpenBlockchain={handleOpenBlockchain}
            />
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
        </div>
    );
}
