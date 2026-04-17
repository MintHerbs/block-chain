import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase.js';
import { storeUserOnChain } from '../security/blockchainService.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    async function fetchUserProfile(authUserId) {
        const { data } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUserId)
            .single();
        return data;
    }

    useEffect(() => {
        // Get the initial session on mount
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (session?.user) {
                const profile = await fetchUserProfile(session.user.id);
                setUser(profile);
            }
            setLoading(false);
        });

        // Listen for auth state changes (login, logout, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (session?.user) {
                    const profile = await fetchUserProfile(session.user.id);
                    setUser(profile);
                } else {
                    setUser(null);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    async function signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }

    async function signUp(email, password, username, displayName) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        // Insert the public user profile row
        const { error: insertError } = await supabase.from('users').insert({
            id: data.user.id,
            username,
            display_name: displayName,
            email,
            password_hash: 'managed_by_supabase',
            dh_public_key: 'dh_placeholder',
        });
        if (insertError) throw insertError;

        // Optionally store user on blockchain
        // User can reject MetaMask prompt — signup still succeeds
        try {
            const chainResult = await storeUserOnChain(data.user.id, username);
            if (chainResult.success) {
                await supabase
                    .from('users')
                    .update({ blockchain_tx_hash: chainResult.txHash })
                    .eq('id', data.user.id);
            }
        } catch (err) {
            // Gracefully handle MetaMask rejection or errors
            console.warn('Blockchain user storage skipped:', err.message);
        }
    }

    async function signOut() {
        await supabase.auth.signOut();
        setUser(null);
    }

    // Refresh local user profile (e.g. after bio edit)
    async function refreshUser() {
        if (!user?.id) return;
        const profile = await fetchUserProfile(user.id);
        setUser(profile);
    }

    return (
        <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
