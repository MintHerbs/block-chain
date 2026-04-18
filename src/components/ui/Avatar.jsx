import pfp1 from '../../img/pfp1.png';
import pfp2 from '../../img/pfp2.png';
import pfp3 from '../../img/pfp3.png';
import pfp4 from '../../img/pfp4.png';
import styles from './Avatar.module.css';

/**
 * Avatar
 * Props:
 *   size — 'sm' (32px) | 'md' (48px) | 'lg' (120px)  (default: 'md')
 *   avatarIndex — number 1-4 to select pfp image
 *   alt  — alt text
 */
export default function Avatar({ size = 'md', avatarIndex, alt = 'Avatar' }) {
    const avatarMap = { 1: pfp1, 2: pfp2, 3: pfp3, 4: pfp4 };
    const src = avatarMap[avatarIndex] || pfp1;
    
    return (
        <img
            src={src}
            alt={alt}
            className={`${styles.avatar} ${styles[size]}`}
        />
    );
}
