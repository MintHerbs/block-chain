// =============================================================================
// Chat Crypto Module — End-to-End Encryption for Anonymous Chat
// =============================================================================
// Uses Web Crypto API for ECDH key exchange and AES-256-GCM encryption.
// No external libraries required.
// =============================================================================

const EMOJI_SET = [
    '🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪',
    '🔶', '🔷', '💜', '💚', '🧡', '❤️', '💛', '🩵'
];

const WORD_SET = [
    'ocean', 'tiger', 'forest', 'mountain', 'river', 'falcon', 'crystal', 'thunder',
    'garden', 'shadow', 'copper', 'silver', 'violet', 'marble', 'anchor', 'breeze',
    'canyon', 'dragon', 'ember', 'frost', 'glacier', 'harbor', 'iron', 'jasper',
    'lantern', 'meadow', 'nebula', 'orchid', 'phoenix', 'quartz', 'raven', 'storm',
    'temple', 'umbra', 'vertex', 'willow', 'zenith', 'amber', 'basalt', 'cedar',
    'delta', 'eclipse', 'flint', 'granite', 'helix', 'indigo', 'jungle', 'kindle',
    'lotus', 'mirage', 'nexus', 'oasis', 'prism', 'raptor', 'slate', 'tidal',
    'unity', 'vapor', 'walnut', 'xenon', 'yarrow', 'zephyr', 'atlas', 'blaze',
    'cliff', 'dusk', 'echo', 'flame', 'grove', 'haze', 'ivory', 'jade',
    'karma', 'lava', 'moss', 'nova', 'onyx', 'pearl', 'quest', 'reef',
    'sage', 'terra', 'ultra', 'viper', 'wave', 'apex', 'birch', 'coral',
    'dawn', 'earth', 'fern', 'gold', 'hawk', 'isle', 'jewel', 'kelp',
    'lunar', 'maple', 'north', 'olive', 'pine', 'rain', 'sand', 'thorn',
    'ursa', 'vine', 'wind', 'axle', 'bison', 'crane', 'drift', 'elm',
    'fjord', 'glyph', 'heron', 'inlet', 'jay', 'knot', 'larch', 'marsh',
    'nest', 'oak', 'plume', 'ridge', 'spark', 'trout', 'umber', 'vale',
    'wren', 'yew', 'zinc', 'alder', 'brook', 'cove', 'dune', 'egret',
    'forge', 'glen', 'holly', 'iris', 'jolt', 'kite', 'lily', 'mist',
    'node', 'orbit', 'petal', 'quill', 'root', 'seal', 'tide', 'urchin',
    'veil', 'weld', 'yarns', 'zone', 'arch', 'bark', 'clam', 'dove',
    'elk', 'fawn', 'gale', 'helm', 'ibis', 'jute', 'keel', 'lime',
    'moth', 'nook', 'opal', 'palm', 'reed', 'silk', 'teak', 'flax',
    'vow', 'wasp', 'yak', 'zeal', 'aloe', 'bay', 'crow', 'dew',
    'eve', 'fig', 'gem', 'husk', 'imp', 'jet', 'koi', 'loom',
    'mink', 'nib', 'ore', 'pip', 'roe', 'sap', 'tor', 'urn',
    'volt', 'web', 'yam', 'zen', 'ant', 'bow', 'cup', 'den',
    'eel', 'fox', 'gum', 'hen', 'ice', 'jam', 'key', 'log',
    'mug', 'net', 'owl', 'paw', 'ram', 'sun', 'tin', 'urn',
    'van', 'wax', 'yew', 'zip', 'ace', 'bud', 'cob', 'dam',
    'ear', 'fin', 'gap', 'hub', 'ink', 'jig', 'kit', 'lip',
    'mat', 'nap', 'odd', 'pen', 'rig', 'sip', 'tap', 'use',
    'vet', 'wit', 'yap', 'zag', 'ape', 'bat', 'cap', 'dig'
];

/**
 * Generate an ECDH keypair using P-256 curve
 * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>}
 */
export async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        true,
        ['deriveKey', 'deriveBits']
    );
    return keyPair;
}

/**
 * Export a public key to base64 string for storage
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
export async function exportPublicKey(publicKey) {
    const exported = await crypto.subtle.exportKey('spki', publicKey);
    const exportedAsBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    return exportedAsBase64;
}

/**
 * Import a base64 public key string back to CryptoKey
 * @param {string} base64String
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(base64String) {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const publicKey = await crypto.subtle.importKey(
        'spki',
        bytes.buffer,
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        true,
        []
    );
    return publicKey;
}

/**
 * Derive shared secret using ECDH
 * @param {CryptoKey} privateKey - Your private key
 * @param {CryptoKey} otherPublicKey - Other user's public key
 * @returns {Promise<ArrayBuffer>}
 */
export async function deriveSharedSecret(privateKey, otherPublicKey) {
    const sharedSecret = await crypto.subtle.deriveBits(
        {
            name: 'ECDH',
            public: otherPublicKey,
        },
        privateKey,
        256
    );
    return sharedSecret;
}

/**
 * Hash shared secret to verification display (emoji + words)
 * @param {ArrayBuffer} sharedSecret
 * @returns {Promise<{emoji: string[], words: string[]}>}
 */
export async function hashToVerification(sharedSecret) {
    // SHA-512 hash the shared secret
    const hashBuffer = await crypto.subtle.digest('SHA-512', sharedSecret);
    const hashArray = new Uint8Array(hashBuffer);
    
    // First 16 bytes → emoji (4 emoji, each from byte % 16)
    const emoji = [];
    for (let i = 0; i < 4; i++) {
        const byte = hashArray[i];
        emoji.push(EMOJI_SET[byte % 16]);
    }
    
    // Bytes 16-19 → words (4 words, each from byte % 256)
    const words = [];
    for (let i = 16; i < 20; i++) {
        const byte = hashArray[i];
        words.push(WORD_SET[byte % 256]);
    }
    
    return { emoji, words };
}

/**
 * Derive AES-256-GCM encryption key from shared secret using HKDF
 * @param {ArrayBuffer} sharedSecret
 * @returns {Promise<CryptoKey>}
 */
export async function deriveEncryptionKey(sharedSecret) {
    const encoder = new TextEncoder();
    const salt = encoder.encode('confession-chat-v1');
    const info = encoder.encode('aes-256-gcm');
    
    // Import shared secret as raw key material
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        sharedSecret,
        'HKDF',
        false,
        ['deriveKey']
    );
    
    // Derive AES-256-GCM key using HKDF
    const encryptionKey = await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: salt,
            info: info,
        },
        keyMaterial,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['encrypt', 'decrypt']
    );
    
    return encryptionKey;
}

/**
 * Encrypt a message using AES-256-GCM
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<string>} Base64 encoded (IV + ciphertext)
 */
export async function encryptMessage(key, plaintext) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    
    // Generate random 12-byte IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        key,
        data
    );
    
    // Prepend IV to ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    // Convert to base64
    const base64 = btoa(String.fromCharCode(...combined));
    return base64;
}

/**
 * Decrypt a message using AES-256-GCM
 * @param {CryptoKey} key
 * @param {string} base64Ciphertext - Base64 encoded (IV + ciphertext)
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptMessage(key, base64Ciphertext) {
    // Decode base64
    const binaryString = atob(base64Ciphertext);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    
    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        key,
        ciphertext
    );
    
    // Convert to string
    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decrypted);
    return plaintext;
}
