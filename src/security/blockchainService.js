import { ethers } from 'ethers';
import ConfessionRegistryABI from '../abi/ConfessionRegistry.json';

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const RPC_URL = import.meta.env.VITE_ALCHEMY_RPC_URL;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Convert a UUID string (with dashes) to bytes32 format for the contract.
 * Example: "550e8400-e29b-41d4-a716-446655440000" → "0x550e8400e29b41d4a716446655440000000000000000000000000000000000"
 */
function uuidToBytes32(uuid) {
    const hex = uuid.replace(/-/g, '');
    // Pad to 64 chars (32 bytes)
    return '0x' + hex.padEnd(64, '0');
}

/**
 * Convert a hex hash string to bytes32. If it already has 0x, use as-is.
 */
function hashToBytes32(hash) {
    const clean = hash.startsWith('0x') ? hash.slice(2) : hash;
    if (clean.length !== 64) {
        throw new Error(`Invalid hash length: ${clean.length}, expected 64 hex chars`);
    }
    return '0x' + clean;
}

/**
 * Read-only provider using Alchemy RPC directly.
 * Used for all verify/read operations — no wallet needed.
 */
function getReadProvider() {
    return new ethers.JsonRpcProvider(RPC_URL);
}

/**
 * Wallet-backed provider using MetaMask.
 * Used for write operations (storing hashes) — user must approve in MetaMask.
 */
async function getWriteContract() {
    if (!window.ethereum) {
        throw new Error('MetaMask is not installed. Install it from metamask.io to write to blockchain.');
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);  // prompt user to connect if needed

    // Check network — must be Sepolia (chainId 0xaa36a7 = 11155111)
    const network = await provider.getNetwork();
    if (network.chainId !== 11155111n) {
        throw new Error('Please switch MetaMask to Sepolia network.');
    }

    const signer = await provider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, ConfessionRegistryABI, signer);
}

function getReadContract() {
    const provider = getReadProvider();
    return new ethers.Contract(CONTRACT_ADDRESS, ConfessionRegistryABI, provider);
}

// ─────────────────────────────────────────────────────────────
// WRITE OPERATIONS (require MetaMask)
// ─────────────────────────────────────────────────────────────

/**
 * Store a confession hash on-chain. Called after the 2-minute edit window.
 * @returns { success, txHash, error }
 */
export async function storeConfessionOnChain(confessionId, contentHash) {
    try {
        const contract = await getWriteContract();
        const tx = await contract.storeConfession(
            uuidToBytes32(confessionId),
            hashToBytes32(contentHash)
        );
        const receipt = await tx.wait();
        return { success: true, txHash: receipt.hash };
    } catch (err) {
        console.error('storeConfessionOnChain error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Store a user hash on-chain. Called at signup.
 */
export async function storeUserOnChain(userId, username) {
    try {
        // Hash the user data — SHA-256 of (userId + username)
        const encoder = new TextEncoder();
        const data = encoder.encode(userId + username);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const contract = await getWriteContract();
        const tx = await contract.storeUser(
            uuidToBytes32(userId),
            hashToBytes32(hashHex)
        );
        const receipt = await tx.wait();
        return { success: true, txHash: receipt.hash, userHash: hashHex };
    } catch (err) {
        console.error('storeUserOnChain error:', err);
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────
// READ OPERATIONS (no wallet needed — uses Alchemy directly)
// ─────────────────────────────────────────────────────────────

/**
 * Verify a confession's content hash matches what's on-chain.
 * @returns { verified, onChain, error }
 */
export async function verifyConfessionOnChain(confessionId, contentHash) {
    try {
        const contract = getReadContract();
        const isOnChain = await contract.isConfessionOnChain(uuidToBytes32(confessionId));

        if (!isOnChain) {
            return { verified: false, onChain: false };
        }

        const verified = await contract.verifyConfession(
            uuidToBytes32(confessionId),
            hashToBytes32(contentHash)
        );
        return { verified, onChain: true };
    } catch (err) {
        console.error('verifyConfessionOnChain error:', err);
        return { verified: false, onChain: false, error: err.message };
    }
}

/**
 * Fetch the on-chain record for a confession (hash + timestamp).
 */
export async function getConfessionFromChain(confessionId) {
    try {
        const contract = getReadContract();
        const isOnChain = await contract.isConfessionOnChain(uuidToBytes32(confessionId));

        if (!isOnChain) {
            return { found: false };
        }

        const [contentHash, timestamp] = await contract.getConfession(uuidToBytes32(confessionId));
        return {
            found: true,
            contentHash,
            timestamp: Number(timestamp),   // bigint → number
        };
    } catch (err) {
        console.error('getConfessionFromChain error:', err);
        return { found: false, error: err.message };
    }
}

/**
 * Check if a confession is on-chain (without fetching data).
 */
export async function isConfessionOnChain(confessionId) {
    try {
        const contract = getReadContract();
        return await contract.isConfessionOnChain(uuidToBytes32(confessionId));
    } catch (err) {
        return false;
    }
}
