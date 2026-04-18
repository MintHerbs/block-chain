import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../config/supabase.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import ProfileHeader from '../components/ProfileHeader.jsx';
import EditProfileModal from '../components/EditProfileModal.jsx';
import ConfessionCard from '../components/ConfessionCard.jsx';
import TemporalConfessionCard from '../components/TemporalConfessionCard.jsx';
import Loader from '../components/ui/Loader.jsx';
import styles from './ProfilePage.module.css';

export default function ProfilePage() {
    const { username } = useParams();
    const { user: currentUser, refreshUser } = useAuth();
    const [profileUser, setProfileUser] = useState(null);
    const [confessions, setConfessions] = useState([]);
    const [temporalMode, setTemporalMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [editModalOpen, setEditModalOpen] = useState(false);

    const isOwnProfile = currentUser?.username === username;

    useEffect(() => {
        fetchProfile();
    }, [username]);

    useEffect(() => {
        if (profileUser) {
            fetchConfessions();
        }
    }, [profileUser, temporalMode]);

    const fetchProfile = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        setProfileUser(data);
        setLoading(false);
    };

    const handleProfileSaved = async () => {
        // Refresh the profile data
        await fetchProfile();
        // If it's own profile, refresh the auth context too
        if (isOwnProfile) {
            await refreshUser();
        }
    };

    const fetchConfessions = async () => {
        if (temporalMode) {
            const { data: allConfessions } = await supabase
                .from('confessions')
                .select('*, users(display_name, username, avatar_index)')
                .eq('user_id', profileUser.id)
                .order('created_at', { ascending: false });

            const confessionIds = (allConfessions || []).map((c) => c.id);

            // Fetch edit history
            const { data: edits } = await supabase
                .from('confession_edits')
                .select('*')
                .in('confession_id', confessionIds);

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

            // Merge edits with confessions
            const confessionsWithEdits = (allConfessions || []).map((confession) => ({
                ...confession,
                comments_count: commentCountsMap[confession.id] || 0,
                originalVersion: edits?.find((e) => e.confession_id === confession.id),
            }));

            setConfessions(confessionsWithEdits);
        } else {
            // Normal mode: only non-deleted
            const { data } = await supabase
                .from('confessions')
                .select('*, users(display_name, username, avatar_index)')
                .eq('user_id', profileUser.id)
                .eq('is_deleted', false)
                .order('created_at', { ascending: false });

            const confessionIds = (data || []).map((c) => c.id);

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

            const confessionsWithCounts = (data || []).map((confession) => ({
                ...confession,
                comments_count: commentCountsMap[confession.id] || 0,
            }));

            setConfessions(confessionsWithCounts);
        }
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <Loader size="md" />
            </div>
        );
    }

    if (!profileUser) {
        return (
            <div className={styles.notFound}>
                <p>User not found</p>
            </div>
        );
    }

    return (
        <div>
            <PageHeader title={profileUser.display_name} backButton />
            <ProfileHeader
                user={profileUser}
                isOwnProfile={isOwnProfile}
                temporalMode={temporalMode}
                onToggleTemporal={() => setTemporalMode(!temporalMode)}
                onEditProfile={() => setEditModalOpen(true)}
            />
            {isOwnProfile && (
                <EditProfileModal
                    isOpen={editModalOpen}
                    onClose={() => setEditModalOpen(false)}
                    user={profileUser}
                    onSave={handleProfileSaved}
                />
            )}
            <div className={styles.confessions}>
                {confessions.length === 0 ? (
                    <div className={styles.empty}>
                        <p>No confessions yet</p>
                    </div>
                ) : (
                    confessions.map((confession) =>
                        temporalMode ? (
                            <TemporalConfessionCard
                                key={confession.id}
                                confession={confession}
                                originalVersion={confession.originalVersion}
                                currentUserId={currentUser?.id}
                            />
                        ) : (
                            <ConfessionCard
                                key={confession.id}
                                confession={confession}
                                currentUserId={currentUser?.id}
                            />
                        )
                    )
                )}
            </div>
        </div>
    );
}
