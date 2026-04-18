import { useState } from 'react';
import { supabase } from '../config/supabase.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import SearchInput from '../components/ui/SearchInput.jsx';
import UserResultCard from '../components/UserResultCard.jsx';
import styles from './TemporalPage.module.css';

export default function TemporalPage() {
    const [results, setResults] = useState([]);
    const [searched, setSearched] = useState(false);

    const handleSearch = async (searchTerm) => {
        if (!searchTerm.trim()) {
            setResults([]);
            setSearched(false);
            return;
        }

        setSearched(true);

        // Search users table
        const { data: users } = await supabase
            .from('users')
            .select('username, display_name, is_burned, avatar_index')
            .ilike('username', `%${searchTerm}%`)
            .limit(20);

        // Search temporal_records table
        const { data: temporal } = await supabase
            .from('temporal_records')
            .select('username, display_name, burned_at')
            .ilike('username', `%${searchTerm}%`)
            .limit(20);

        // Merge and deduplicate
        const allResults = [
            ...(users || []),
            ...(temporal || []).map(t => ({ ...t, is_burned: true })),
        ];

        const uniqueResults = Array.from(
            new Map(allResults.map(r => [r.username, r])).values()
        );

        setResults(uniqueResults);
    };

    return (
        <div>
            <PageHeader title="Temporal" />
            <div className={styles.searchSection}>
                <SearchInput
                    placeholder="Search usernames..."
                    onSearch={handleSearch}
                />
            </div>
            <div className={styles.results}>
                {!searched ? (
                    <div className={styles.empty}>
                        <p>Search for usernames to find their confessions — even if they've been burned.</p>
                    </div>
                ) : results.length === 0 ? (
                    <div className={styles.empty}>
                        <p>No users found matching that username.</p>
                    </div>
                ) : (
                    results.map((user) => (
                        <UserResultCard key={user.username} user={user} />
                    ))
                )}
            </div>
        </div>
    );
}
