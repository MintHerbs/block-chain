import { useNavigate } from 'react-router-dom';
import Avatar from './ui/Avatar.jsx';
import Badge from './ui/Badge.jsx';
import styles from './UserResultCard.module.css';

export default function UserResultCard({ user }) {
    const navigate = useNavigate();

    return (
        <article
            className={styles.card}
            onClick={() => navigate(`/profile/${user.username}`)}
        >
            <Avatar size="sm" avatarIndex={user.avatar_index} />
            <div className={styles.info}>
                <div className={styles.nameRow}>
                    <span className={styles.displayName}>{user.display_name}</span>
                    {user.is_burned && <Badge variant="danger">Burned</Badge>}
                </div>
                <span className={styles.username}>@{user.username}</span>
            </div>
        </article>
    );
}
