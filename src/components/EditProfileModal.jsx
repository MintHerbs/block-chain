import { useState } from 'react';
import { supabase } from '../config/supabase.js';
import { sanitizeDisplayName } from '../security/sanitize.js';
import Modal from './ui/Modal.jsx';
import Input from './ui/Input.jsx';
import Button from './ui/Button.jsx';
import pfp1 from '../img/pfp1.png';
import pfp2 from '../img/pfp2.png';
import pfp3 from '../img/pfp3.png';
import pfp4 from '../img/pfp4.png';
import styles from './EditProfileModal.module.css';

const avatarOptions = [
    { index: 1, src: pfp1 },
    { index: 2, src: pfp2 },
    { index: 3, src: pfp3 },
    { index: 4, src: pfp4 },
];

export default function EditProfileModal({ isOpen, onClose, user, onSave }) {
    const [displayName, setDisplayName] = useState(user.display_name || '');
    const [selectedAvatar, setSelectedAvatar] = useState(user.avatar_index || 1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        try {
            setError('');
            setLoading(true);

            const cleanDisplayName = sanitizeDisplayName(displayName);
            
            if (cleanDisplayName.length < 1 || cleanDisplayName.length > 100) {
                throw new Error('Display name must be 1-100 characters');
            }

            const { error: updateError } = await supabase
                .from('users')
                .update({
                    display_name: cleanDisplayName,
                    avatar_index: selectedAvatar,
                })
                .eq('id', user.id);

            if (updateError) throw updateError;

            if (onSave) {
                await onSave();
            }
            
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Edit Profile">
            <div className={styles.content}>
                <div className={styles.section}>
                    <label className={styles.label}>Display Name</label>
                    <Input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your display name"
                        maxLength={100}
                    />
                </div>

                <div className={styles.section}>
                    <label className={styles.label}>Profile Picture</label>
                    <div className={styles.avatarGrid}>
                        {avatarOptions.map((option) => (
                            <button
                                key={option.index}
                                type="button"
                                className={`${styles.avatarOption} ${
                                    selectedAvatar === option.index ? styles.selected : ''
                                }`}
                                onClick={() => setSelectedAvatar(option.index)}
                            >
                                <img src={option.src} alt={`Avatar ${option.index}`} />
                            </button>
                        ))}
                    </div>
                </div>

                {error && <p className={styles.error}>{error}</p>}

                <div className={styles.actions}>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSave} loading={loading}>
                        Save Changes
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
