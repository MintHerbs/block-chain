require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://lwpgevacshnlmyexyuhm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hutvqchdXl2isJ-oI7i8iA_iUyO3KyZ';
const RPC_URL = process.env.ALCHEMY_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.VITE_CONTRACT_ADDRESS;

const ABI = [
  "function storeConfession(bytes32 confessionId, bytes32 contentHash) external",
  "function storeUser(bytes32 userId, bytes32 contentHash) external",
  "function isConfessionOnChain(bytes32 confessionId) external view returns (bool)",
];

function uuidToBytes32(uuid) {
  return '0x' + uuid.replace(/-/g, '').padEnd(64, '0');
}

function hashToBytes32(hash) {
  const clean = hash.startsWith('0x') ? hash.slice(2) : hash;
  return '0x' + clean.padEnd(64, '0');
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error: ${res.status} ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  console.log('Starting blockchain sync...');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  // Fetch expired confessions that need blockchain writing
  const now = new Date().toISOString();
  const confessions = await supabaseFetch(
    `/confessions?opt_in_blockchain=eq.true&is_on_chain=eq.false&edit_window_expires_at=lt.${encodeURIComponent(now)}&select=id,content_hash&limit=10`
  );

  if (!confessions || confessions.length === 0) {
    console.log('No confessions to sync.');
    return;
  }

  console.log(`Found ${confessions.length} confession(s) to sync.`);

  for (const confession of confessions) {
    try {
      console.log(`Processing confession ${confession.id}...`);

      const confessionId = uuidToBytes32(confession.id);
      const contentHash = hashToBytes32(confession.content_hash);

      // Check if already on chain (avoid duplicate error)
      const alreadyOnChain = await contract.isConfessionOnChain(confessionId);
      if (alreadyOnChain) {
        console.log(`Already on chain, updating DB only: ${confession.id}`);
        await supabaseFetch(`/confessions?id=eq.${confession.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_on_chain: true }),
          headers: { 'Prefer': 'return=minimal' },
        });
        
        // Insert into blockchain_sync_log so the graph picks it up
        await supabaseFetch('/blockchain_sync_log', {
          method: 'POST',
          body: JSON.stringify({
            entity_type: 'confession',
            entity_id: confession.id,
            tx_hash: 'already-on-chain',
            status: 'confirmed',
          }),
          headers: { 'Prefer': 'return=minimal' },
        });
        continue;
      }

      const tx = await contract.storeConfession(confessionId, contentHash);
      console.log(`TX sent: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`Confirmed: ${receipt.hash}`);

      // Update Supabase
      await supabaseFetch(`/confessions?id=eq.${confession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          is_on_chain: true,
          blockchain_tx_hash: receipt.hash,
        }),
        headers: { 'Prefer': 'return=minimal' },
      });

      // Insert into blockchain_sync_log for graph visualization
      await supabaseFetch('/blockchain_sync_log', {
        method: 'POST',
        body: JSON.stringify({
          entity_type: 'confession',
          entity_id: confession.id,
          tx_hash: receipt.hash,
          status: 'confirmed',
        }),
        headers: { 'Prefer': 'return=minimal' },
      });

      console.log(`✅ Done: ${confession.id}`);
    } catch (err) {
      console.error(`❌ Failed for ${confession.id}:`, err.message);
    }
  }

  console.log('Sync complete.');
}

main().catch(console.error);
