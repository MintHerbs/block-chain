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
        
        // Backfill avatar_index and cover_color if missing
        if (data && (data.avatar_index == null || data.cover_color == null)) {
            const avatarIndex = data.avatar_index ?? Math.floor(Math.random() * 4) + 1;
            const coverColors = ['#FFDDD2', '#D4E8C2', '#C9E4DE', '#D6D0F0', '#FAE1C3', '#C5D8F0', '#F5C6D0', '#D0EAD0'];
            const coverColor = data.cover_color ?? coverColors[Math.floor(Math.random() * coverColors.length)];
            
            await supabase
                .from('users')
                .update({ avatar_index: avatarIndex, cover_color: coverColor })
                .eq('id', authUserId);
            
            // Update local data to reflect changes immediately
            data.avatar_index = avatarIndex;
            data.cover_color = coverColor;
        }
        
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

        // Generate random avatar and cover color
        const avatarIndex = Math.floor(Math.random() * 4) + 1;
        const coverColors = ['#FFDDD2', '#D4E8C2', '#C9E4DE', '#D6D0F0', '#FAE1C3', '#C5D8F0', '#F5C6D0', '#D0EAD0'];
        const coverColor = coverColors[Math.floor(Math.random() * coverColors.length)];

        // Insert the public user profile row
        const { error: insertError } = await supabase.from('users').insert({
            id: data.user.id,
            username,
            display_name: displayName,
            email,
            password_hash: 'managed_by_supabase',
            dh_public_key: 'dh_placeholder',
            avatar_index: avatarIndex,
            cover_color: coverColor,
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
