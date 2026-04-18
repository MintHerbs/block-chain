import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../config/supabase.js';
import Modal from './ui/Modal.jsx';
import Input from './ui/Input.jsx';
import Button from './ui/Button.jsx';
import { FireIcon } from './ui/icons.jsx';
import styles from './BurnModal.module.css';

export default function BurnModal({ isOpen, onClose }) {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [confirmText, setConfirmText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleBurn = async () => {
        if (confirmText !== 'DELETE') return;

        setLoading(true);
        setError('');

        try {
            const burnedAt = new Date().toISOString();

            // 1. Insert into temporal_records (snapshot)
            const { error: temporalError } = await supabase.from('temporal_records').insert({
                original_user_id: user.id,
                username: user.username,
                display_name: user.display_name,
                blockchain_tx_hash: user.blockchain_tx_hash || null,
                burned_at: burnedAt,
            });

            if (temporalError) throw temporalError;

            // 2. Mark user as burned (before deletion for audit trail)
            const { error: updateError } = await supabase.from('users').update({
                is_burned: true,
                burned_at: burnedAt,
            }).eq('id', user.id);

            if (updateError) throw updateError;

            // 3. Delete user (CASCADE handles confessions, comments, votes)
            const { error: deleteError } = await supabase.from('users').delete().eq('id', user.id);

            if (deleteError) throw deleteError;

            // 4. Sign out and redirect
            await signOut();
            navigate('/login');
        } catch (err) {
            console.error('Burn error:', err);
            setError(err.message || 'Failed to burn account');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <div className={styles.content}>
                <div className={styles.iconWrapper}>
                    <FireIcon size={48} color="var(--danger)" />
                </div>
                <h2 className={styles.title}>Burn Account</h2>
                <p className={styles.warning}>
                    This will permanently delete all your data from the database. Anything already written to the blockchain will remain forever. This action cannot be undone.
                </p>
                <Input
                    placeholder="Type DELETE to confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    error={error}
                />
                <Button
                    variant="danger"
                    fullWidth
                    disabled={confirmText !== 'DELETE'}
                    loading={loading}
                    onClick={handleBurn}
                >
                    Burn Everything
                </Button>
                <button className={styles.cancel} onClick={onClose}>
                    Cancel
                </button>
            </div>
        </Modal>
    );
}
