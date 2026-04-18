import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Avatar from './ui/Avatar.jsx';
import Dropdown from './ui/Dropdown.jsx';
import { HomeIcon, TemporalIcon, MessageCircleIcon, MoreIcon, LogoutIcon, FireIcon } from './ui/icons.jsx';
import BurnModal from './BurnModal.jsx';
import styles from './Sidebar.module.css';

export default function Sidebar() {
    const { user, signOut } = useAuth();
    const [moreOpen, setMoreOpen] = useState(false);
    const [burnModalOpen, setBurnModalOpen] = useState(false);

    const moreItems = [
        {
            label: 'Sign Out',
            icon: <LogoutIcon size={20} />,
            onClick: signOut,
        },
        {
            label: 'BURN',
            icon: <FireIcon size={20} />,
            onClick: () => setBurnModalOpen(true),
            variant: 'danger',
        },
    ];

    return (
        <aside className={styles.sidebar}>
            <div className={styles.logo}>Confessions</div>

            <nav className={styles.nav}>
                <NavLink
                    to="/"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    end
                >
                    <HomeIcon size={24} />
                    <span>Global</span>
                </NavLink>

                <NavLink
                    to="/chat"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                >
                    <MessageCircleIcon size={24} />
                    <span>Chat</span>
                </NavLink>

                <NavLink
                    to="/temporal"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                >
                    <TemporalIcon size={24} />
                    <span>Temporal</span>
                </NavLink>

                <div style={{ position: 'relative' }}>
                    <button
                        className={`${styles.navItem} ${moreOpen ? styles.active : ''}`}
                        onClick={() => setMoreOpen(!moreOpen)}
                    >
                        <MoreIcon size={24} />
                        <span>More</span>
                    </button>
                    <Dropdown
                        isOpen={moreOpen}
                        onClose={() => setMoreOpen(false)}
                        items={moreItems}
                        position="above"
                    />
                </div>
            </nav>

            {user && (
                <NavLink to={`/profile/${user.username}`} className={styles.userPill}>
                    <Avatar size="sm" avatarIndex={user.avatar_index} />
                    <div className={styles.userInfo}>
                        <div className={styles.displayName}>{user.display_name}</div>
                        <div className={styles.username}>@{user.username}</div>
                    </div>
                </NavLink>
            )}

            <BurnModal isOpen={burnModalOpen} onClose={() => setBurnModalOpen(false)} />
        </aside>
    );
}
