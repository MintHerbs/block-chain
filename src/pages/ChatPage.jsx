// NOTE: Supabase Realtime must be enabled for chat_sessions and chat_messages tables.
// Go to Supabase Dashboard → Database → Replication → Enable for: chat_sessions, chat_messages

import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Loader from '../components/ui/Loader.jsx';
import { MessageCircleIcon } from '../components/ui/icons.jsx';
import styles from './ChatPage.module.css';

export default function ChatPage() {
    const { user } = useAuth();
    const [state, setState] = useState('idle'); // 'idle' | 'lobby' | 'verifying' | 'chatting'
    const [timeLeft, setTimeLeft] = useState(300); // 5 minutes in seconds
    const [verification, setVerification] = useState(null); // { emoji: [], words: [] }
    const [messages, setMessages] = useState([]);
    const [messageInput, setMessageInput] = useState('');
    const [leaveModalOpen, setLeaveModalOpen] = useState(false);
    const [otherUserLeft, setOtherUserLeft] = useState(false);

    // ========== STATE: IDLE ==========
    if (state === 'idle') {
        return (
            <div className={styles.centeredState}>
                <div className={styles.idleContent}>
                    <MessageCircleIcon size={64} color="var(--text-muted)" />
                    <h1 className={styles.title}>Anonymous Chat</h1>
                    <p className={styles.subtitle}>
                        You'll be randomly matched with another user. The conversation is encrypted and destroyed when either of you leaves.
                    </p>
                    <Button
                        variant="primary"
                        size="lg"
                        onClick={() => setState('lobby')}
                    >
                        Find someone to talk to
                    </Button>
                </div>
            </div>
        );
    }

    // ========== STATE: LOBBY ==========
    if (state === 'lobby') {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        const timeDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        return (
            <div className={styles.centeredState}>
                <div className={styles.lobbyContent}>
                    <div className={styles.pulsingLoader}>
                        <Loader size="md" />
                    </div>
                    <h2 className={styles.lobbyTitle}>Looking for someone...</h2>
                    <p className={styles.timer}>⏱ {timeDisplay} remaining</p>
                    <Button
                        variant="outline"
                        onClick={() => setState('idle')}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        );
    }

    // ========== STATE: VERIFYING ==========
    if (state === 'verifying') {
        return (
            <div className={styles.centeredState}>
                <div className={styles.verifyContent}>
                    <h2 className={styles.verifyTitle}>Connection Established</h2>
                    
                    {verification ? (
                        <>
                            <div className={styles.verificationBox}>
                                <div className={styles.emojiRow}>
                                    {verification.emoji.map((emoji, i) => (
                                        <span key={i} className={styles.emoji}>{emoji}</span>
                                    ))}
                                </div>
                                <div className={styles.wordPhrase}>
                                    {verification.words.join(' — ')}
                                </div>
                            </div>
                            
                            <p className={styles.verifyExplanation}>
                                Both you and your match see the same icons and words above. If they look different, someone might be listening in.
                            </p>
                            
                            <div className={styles.verifyButtons}>
                                <Button
                                    variant="primary"
                                    fullWidth
                                    onClick={() => setState('chatting')}
                                >
                                    Looks good, start chatting
                                </Button>
                                <Button
                                    variant="outline"
                                    fullWidth
                                    onClick={() => setState('idle')}
                                    style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                                >
                                    Something's wrong
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className={styles.exchangingKeys}>
                            <Loader size="md" />
                            <p className={styles.exchangingText}>Exchanging keys...</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ========== STATE: CHATTING ==========
    if (state === 'chatting') {
        const handleSendMessage = () => {
            if (!messageInput.trim()) return;
            
            // TODO: Wire up actual send logic in Step 3
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                text: messageInput,
                isMine: true,
                timestamp: new Date().toISOString(),
            }]);
            setMessageInput('');
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        };

        const formatTime = (timestamp) => {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        };

        return (
            <div className={styles.chattingContainer}>
                {/* Top Bar */}
                <div className={styles.topBar}>
                    <span className={styles.topBarTitle}>Anonymous Chat</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLeaveModalOpen(true)}
                        style={{ color: 'var(--danger)' }}
                    >
                        Leave
                    </Button>
                </div>

                {/* Messages Area */}
                <div className={styles.messagesArea}>
                    {messages.length === 0 ? (
                        <div className={styles.emptyMessages}>
                            <p>Start the conversation...</p>
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`${styles.messageWrapper} ${msg.isMine ? styles.mine : styles.theirs}`}
                            >
                                <div className={`${styles.messageBubble} ${msg.isMine ? styles.mineBubble : styles.theirsBubble}`}>
                                    {msg.text}
                                </div>
                                <div className={styles.messageTime}>
                                    {formatTime(msg.timestamp)}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Input Bar */}
                <div className={styles.inputBar}>
                    <input
                        type="text"
                        className={styles.messageInput}
                        placeholder="Type a message..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button
                        className={styles.sendButton}
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim()}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                </div>

                {/* Leave Confirmation Modal */}
                <Modal
                    isOpen={leaveModalOpen}
                    onClose={() => setLeaveModalOpen(false)}
                    title="Leave chat?"
                >
                    <div className={styles.leaveModalContent}>
                        <p>The conversation will be permanently destroyed.</p>
                        <div className={styles.leaveModalButtons}>
                            <Button
                                variant="outline"
                                onClick={() => setLeaveModalOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => {
                                    setLeaveModalOpen(false);
                                    setState('idle');
                                    setMessages([]);
                                }}
                            >
                                Leave
                            </Button>
                        </div>
                    </div>
                </Modal>

                {/* Other User Left Overlay */}
                {otherUserLeft && (
                    <div className={styles.overlay}>
                        <div className={styles.overlayCard}>
                            <h3>The other user has left</h3>
                            <p>The conversation has been destroyed.</p>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    setOtherUserLeft(false);
                                    setState('idle');
                                    setMessages([]);
                                }}
                            >
                                Back to lobby
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return null;
}
