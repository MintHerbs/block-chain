// NOTE: Supabase Realtime must be enabled for chat_sessions and chat_messages tables.
// Go to Supabase Dashboard → Database → Replication → Enable for: chat_sessions, chat_messages

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../config/supabase.js';
import { sanitizeText } from '../security/sanitize.js';
import {
    generateKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveSharedSecret,
    hashToVerification,
    deriveEncryptionKey,
    encryptMessage,
    decryptMessage,
} from '../security/chatCrypto.js';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Loader from '../components/ui/Loader.jsx';
import { MessageCircleIcon } from '../components/ui/icons.jsx';
import styles from './ChatPage.module.css';

export default function ChatPage() {
    const { user } = useAuth();
    const [state, setState] = useState('idle'); // 'idle' | 'lobby' | 'verifying' | 'chatting'
    const [timeLeft, setTimeLeft] = useState(300);
    const [verification, setVerification] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messageInput, setMessageInput] = useState('');
    const [leaveModalOpen, setLeaveModalOpen] = useState(false);
    const [otherUserLeft, setOtherUserLeft] = useState(false);
    const [timeoutMessage, setTimeoutMessage] = useState('');

    // Session state
    const [sessionId, setSessionId] = useState(null);
    const [isUserA, setIsUserA] = useState(false);
    const [encryptionKey, setEncryptionKey] = useState(null);

    // Refs for intervals and channels
    const heartbeatInterval = useRef(null);
    const matchInterval = useRef(null);
    const countdownInterval = useRef(null);
    const keyPollInterval = useRef(null);
    const msgPollInterval = useRef(null);
    const sessionChannel = useRef(null);
    const verifyChannel = useRef(null);
    const msgChannel = useRef(null);
    const sessionWatchChannel = useRef(null);
    const messagesEndRef = useRef(null);
    const seenMessageIds = useRef(new Set()); // tracks IDs already rendered, avoids duplicates

    // Use a ref (not state) for the key-exchange guard so it never triggers an effect re-run.
    // Bug that was here: storing this in state caused the verifying effect to re-run, which
    // generated a fresh keypair and overwrote the public key already read by the other user.
    const verificationDoneRef = useRef(false);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ========== LOBBY STATE LOGIC ==========
    useEffect(() => {
        if (state !== 'lobby') return;

        let mounted = true;

        // Central transition helper — clears all lobby timers/channels before switching state.
        const transitionToVerifying = (sid, isA) => {
            if (!mounted) return;
            clearInterval(heartbeatInterval.current);
            clearInterval(matchInterval.current);
            clearInterval(countdownInterval.current);
            if (sessionChannel.current) {
                supabase.removeChannel(sessionChannel.current);
                sessionChannel.current = null;
            }
            setSessionId(sid);
            setIsUserA(isA);
            setState('verifying');
        };

        const enterLobby = async () => {
            // Start countdown immediately — before any async work so the timer is
            // never frozen waiting for Supabase round-trips.
            setTimeLeft(300);
            countdownInterval.current = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        clearInterval(countdownInterval.current);
                        clearInterval(heartbeatInterval.current);
                        clearInterval(matchInterval.current);
                        if (mounted) {
                            setTimeoutMessage("No one's around right now. Try again later.");
                            setTimeout(() => {
                                if (mounted) {
                                    setState('idle');
                                    setTimeoutMessage('');
                                }
                            }, 3000);
                        }
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            try {
                // 1. Clean up: end any lingering active sessions and reset queue entry.
                //    Stale sessions from previous runs would otherwise be found by Step A
                //    immediately, causing a false match transition.
                const { data: staleSessions } = await supabase
                    .from('chat_sessions')
                    .select('id')
                    .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
                    .eq('is_active', true);
                if (staleSessions) {
                    for (const s of staleSessions) {
                        await supabase.rpc('end_chat_session', { p_session_id: s.id });
                    }
                }
                await supabase.rpc('clean_stale_queue');
                await supabase.from('chat_queue').delete().eq('user_id', user.id);
                await supabase.from('chat_queue').insert({ user_id: user.id });

                if (!mounted) return;

                // 2. Heartbeat — every 10 seconds
                heartbeatInterval.current = setInterval(async () => {
                    await supabase
                        .from('chat_queue')
                        .update({ last_heartbeat: new Date().toISOString() })
                        .eq('user_id', user.id);
                }, 10000);

                // 3. Match polling — start immediately after queue insert so detection
                //    works as soon as we're in the queue, regardless of Realtime status.
                matchInterval.current = setInterval(async () => {
                    if (!mounted) return;

                    // Step A: look for an existing active session for this user.
                    // This catches the critical failure mode: if the other user created the session,
                    // the queue entry is marked is_matched=TRUE, so match_chat_users returns nothing.
                    // Without this check the user would be stuck in lobby forever.
                    const { data: existing } = await supabase
                        .from('chat_sessions')
                        .select('id, user_a, user_b')
                        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
                        .eq('is_active', true)
                        .order('started_at', { ascending: false })
                        .limit(1);

                    if (existing && existing.length > 0 && mounted) {
                        transitionToVerifying(existing[0].id, existing[0].user_a === user.id);
                        return;
                    }

                    // Step B: try to create a new match.
                    const { data: matchData, error: matchError } = await supabase.rpc('match_chat_users');
                    if (matchError) {
                        console.error('match_chat_users RPC error:', matchError);
                    }
                    if (matchData && matchData.length > 0 && mounted) {
                        // Re-query with consistent ORDER BY so both users always pick the same
                        // session if a race condition created two simultaneously.
                        const { data: sessions } = await supabase
                            .from('chat_sessions')
                            .select('id, user_a, user_b')
                            .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
                            .eq('is_active', true)
                            .order('started_at', { ascending: false })
                            .limit(1);

                        if (sessions && sessions.length > 0 && mounted) {
                            transitionToVerifying(sessions[0].id, sessions[0].user_a === user.id);
                        } else if (mounted) {
                            // Fallback: use what the RPC told us directly
                            const match = matchData[0];
                            transitionToVerifying(match.session_id, match.matched_user_a === user.id);
                        }
                    }
                }, 3000);

                // 4. Realtime: instant match detection when other user creates the session.
                //    Use a per-user channel name to avoid collisions between clients.
                sessionChannel.current = supabase
                    .channel(`lobby-${user.id}`)
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'chat_sessions',
                    }, (payload) => {
                        const session = payload.new;
                        if ((session.user_a === user.id || session.user_b === user.id) && mounted) {
                            transitionToVerifying(session.id, session.user_a === user.id);
                        }
                    })
                    .subscribe();

            } catch (error) {
                console.error('Error entering lobby:', error);
            }
        };

        enterLobby();

        return () => {
            mounted = false;
            clearInterval(heartbeatInterval.current);
            clearInterval(matchInterval.current);
            clearInterval(countdownInterval.current);
            if (sessionChannel.current) {
                supabase.removeChannel(sessionChannel.current);
            }
            supabase.from('chat_queue').delete().eq('user_id', user.id);
        };
    }, [state, user.id]);

    // ========== VERIFYING STATE LOGIC ==========
    useEffect(() => {
        if (state !== 'verifying' || !sessionId) return;

        // Reset the guard each time we freshly enter the verifying state.
        verificationDoneRef.current = false;

        let mounted = true;

        // Attempt to derive the shared secret once both public keys are present.
        // Marked with the ref immediately to prevent concurrent/duplicate calls.
        const tryDeriveKeys = async (session, privateKey) => {
            if (verificationDoneRef.current || !mounted) return;

            const otherKeyColumn = isUserA ? 'user_b_public_key' : 'user_a_public_key';
            if (!session[otherKeyColumn]) return;

            verificationDoneRef.current = true; // Lock before async work

            try {
                const otherPubKey = await importPublicKey(session[otherKeyColumn]);
                const sharedSecret = await deriveSharedSecret(privateKey, otherPubKey);
                const verificationData = await hashToVerification(sharedSecret);
                const encKey = await deriveEncryptionKey(sharedSecret);

                if (mounted) {
                    setVerification(verificationData);
                    setEncryptionKey(encKey);
                    clearInterval(keyPollInterval.current);
                }
            } catch (error) {
                verificationDoneRef.current = false; // Allow retry on crypto failure
                console.error('Error deriving keys:', error);
            }
        };

        const setupVerification = async () => {
            try {
                // 1. Generate ECDH keypair and publish our public key
                const { publicKey, privateKey } = await generateKeyPair();
                const exportedPubKey = await exportPublicKey(publicKey);

                const keyColumn = isUserA ? 'user_a_public_key' : 'user_b_public_key';
                await supabase
                    .from('chat_sessions')
                    .update({ [keyColumn]: exportedPubKey })
                    .eq('id', sessionId);

                // 2. Realtime: watch for the other user's public key being stored
                verifyChannel.current = supabase
                    .channel(`session-${sessionId}`)
                    .on('postgres_changes', {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'chat_sessions',
                        filter: `id=eq.${sessionId}`,
                    }, async (payload) => {
                        await tryDeriveKeys(payload.new, privateKey);
                    })
                    .subscribe();

                // 3. Check immediately in case the other user stored their key before we subscribed
                const { data: currentSession } = await supabase
                    .from('chat_sessions')
                    .select('*')
                    .eq('id', sessionId)
                    .single();

                if (currentSession) {
                    await tryDeriveKeys(currentSession, privateKey);
                }

                // 4. Fallback poll — in case Realtime misses the UPDATE event.
                //    Polls every 2 seconds until keys are derived.
                keyPollInterval.current = setInterval(async () => {
                    if (verificationDoneRef.current || !mounted) {
                        clearInterval(keyPollInterval.current);
                        return;
                    }
                    const { data: session } = await supabase
                        .from('chat_sessions')
                        .select('*')
                        .eq('id', sessionId)
                        .single();
                    if (session) {
                        await tryDeriveKeys(session, privateKey);
                    }
                }, 2000);
            } catch (error) {
                console.error('Error setting up verification:', error);
            }
        };

        setupVerification();

        return () => {
            mounted = false;
            clearInterval(keyPollInterval.current);
            if (verifyChannel.current) {
                supabase.removeChannel(verifyChannel.current);
            }
        };
        // IMPORTANT: verificationDoneRef is intentionally NOT in the dependency array.
        // Adding state to this dep array was the original bug — it caused a re-run that
        // generated a new keypair and overwrote the public key in the DB.
    }, [state, sessionId, isUserA]);

    // ========== CHATTING STATE LOGIC ==========
    useEffect(() => {
        if (state !== 'chatting' || !sessionId || !encryptionKey) return;

        let mounted = true;
        seenMessageIds.current = new Set(); // reset on each new chat session

        // Decrypt and render a message from the other user, deduplicating via seenMessageIds.
        const addIncomingMessage = async (msg) => {
            if (!mounted) return;
            if (msg.sender_id === user.id) return; // own messages added locally on send
            if (seenMessageIds.current.has(msg.id)) return; // already rendered
            seenMessageIds.current.add(msg.id);
            try {
                const plaintext = await decryptMessage(encryptionKey, msg.encrypted_content);
                if (mounted) {
                    setMessages(prev => [...prev, {
                        id: msg.id,
                        text: plaintext,
                        isMine: false,
                        timestamp: msg.created_at,
                    }]);
                }
            } catch (error) {
                console.error('Error decrypting message:', error);
            }
        };

        const setupChat = async () => {
            try {
                // Primary: Realtime subscription for instant delivery
                msgChannel.current = supabase
                    .channel(`messages-${sessionId}`)
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'chat_messages',
                        filter: `session_id=eq.${sessionId}`,
                    }, async (payload) => {
                        await addIncomingMessage(payload.new);
                    })
                    .subscribe();

                // Watch for the session ending (other user left)
                sessionWatchChannel.current = supabase
                    .channel(`session-watch-${sessionId}`)
                    .on('postgres_changes', {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'chat_sessions',
                        filter: `id=eq.${sessionId}`,
                    }, (payload) => {
                        if (payload.new.is_active === false && mounted) {
                            setOtherUserLeft(true);
                        }
                    })
                    .subscribe();

                // Fallback: poll every 3 seconds for messages from the other user.
                // This ensures delivery even if Realtime is not enabled for chat_messages
                // or if the RLS policy silently blocks the postgres_changes event.
                msgPollInterval.current = setInterval(async () => {
                    if (!mounted) return;
                    const { data: msgs } = await supabase
                        .from('chat_messages')
                        .select('*')
                        .eq('session_id', sessionId)
                        .neq('sender_id', user.id)
                        .order('created_at', { ascending: true });
                    if (msgs) {
                        for (const msg of msgs) {
                            await addIncomingMessage(msg);
                        }
                    }
                }, 3000);
            } catch (error) {
                console.error('Error setting up chat:', error);
            }
        };

        setupChat();

        return () => {
            mounted = false;
            clearInterval(msgPollInterval.current);
            if (msgChannel.current) {
                supabase.removeChannel(msgChannel.current);
            }
            if (sessionWatchChannel.current) {
                supabase.removeChannel(sessionWatchChannel.current);
            }
        };
    }, [state, sessionId, encryptionKey, user.id]);

    // ========== CLEANUP ON UNMOUNT ==========
    useEffect(() => {
        return () => {
            clearInterval(heartbeatInterval.current);
            clearInterval(matchInterval.current);
            clearInterval(countdownInterval.current);
            clearInterval(keyPollInterval.current);
            clearInterval(msgPollInterval.current);

            if (sessionChannel.current) supabase.removeChannel(sessionChannel.current);
            if (verifyChannel.current) supabase.removeChannel(verifyChannel.current);
            if (msgChannel.current) supabase.removeChannel(msgChannel.current);
            if (sessionWatchChannel.current) supabase.removeChannel(sessionWatchChannel.current);

            if (state === 'lobby') {
                supabase.from('chat_queue').delete().eq('user_id', user.id);
            }
            if ((state === 'verifying' || state === 'chatting') && sessionId) {
                supabase.rpc('end_chat_session', { p_session_id: sessionId });
            }
        };
    }, []);

    // ========== HELPER FUNCTIONS ==========
    const handleCancelLobby = async () => {
        clearInterval(heartbeatInterval.current);
        clearInterval(matchInterval.current);
        clearInterval(countdownInterval.current);
        if (sessionChannel.current) {
            supabase.removeChannel(sessionChannel.current);
        }
        await supabase.from('chat_queue').delete().eq('user_id', user.id);
        setState('idle');
    };

    const handleSomethingWrong = async () => {
        clearInterval(keyPollInterval.current);
        verificationDoneRef.current = false;
        if (verifyChannel.current) {
            supabase.removeChannel(verifyChannel.current);
            verifyChannel.current = null;
        }
        if (sessionId) {
            await supabase.rpc('end_chat_session', { p_session_id: sessionId });
        }
        setSessionId(null);
        setVerification(null);
        setState('idle');
    };

    const handleSendMessage = async () => {
        if (!messageInput.trim() || !encryptionKey || !sessionId) return;

        try {
            const sanitized = sanitizeText(messageInput);
            if (!sanitized) return;

            const encrypted = await encryptMessage(encryptionKey, sanitized);

            await supabase.from('chat_messages').insert({
                session_id: sessionId,
                sender_id: user.id,
                encrypted_content: encrypted,
            });

            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                text: sanitized,
                isMine: true,
                timestamp: new Date().toISOString(),
            }]);

            setMessageInput('');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    };

    const handleLeaveChat = async () => {
        clearInterval(msgPollInterval.current);
        if (msgChannel.current) {
            supabase.removeChannel(msgChannel.current);
        }
        if (sessionWatchChannel.current) {
            supabase.removeChannel(sessionWatchChannel.current);
        }
        if (sessionId) {
            await supabase.rpc('end_chat_session', { p_session_id: sessionId });
        }
        verificationDoneRef.current = false;
        setMessages([]);
        setEncryptionKey(null);
        setSessionId(null);
        setVerification(null);
        setLeaveModalOpen(false);
        setState('idle');
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
                    {timeoutMessage && (
                        <p className={styles.timeoutMessage}>{timeoutMessage}</p>
                    )}
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
                        onClick={handleCancelLobby}
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
                                    onClick={handleSomethingWrong}
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
                        <>
                            {messages.map((msg) => (
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
                            ))}
                            <div ref={messagesEndRef} />
                        </>
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
                                onClick={handleLeaveChat}
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
                                    handleLeaveChat();
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
