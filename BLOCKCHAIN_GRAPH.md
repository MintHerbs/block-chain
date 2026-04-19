# BLOCKCHAIN_GRAPH.md — Animated Blockchain Visualizer

Read this ENTIRE file before writing any code.

---

## Overview

Build a two-part UI feature:

1. **`BlockchainCard`** — a small card that sits in the right sidebar of the app showing a live count of on-chain confessions. Clicking it opens the full screen graph.

2. **`BlockchainGraph`** — a full screen animated SVG visualizer showing each on-chain confession as a glowing node, connected in a chain. Nodes animate in when new confessions hit the blockchain. Supabase Realtime keeps it live without refreshing.

---

## Data Source

Query `blockchain_sync_log` for confirmed on-chain records:

```js
supabase
    .from('blockchain_sync_log')
    .select('id, entity_id, tx_hash, synced_at')
    .eq('status', 'confirmed')
    .eq('entity_type', 'confession')
    .order('synced_at', { ascending: true })
```

Each row represents one confession permanently written to the Ethereum Sepolia blockchain. This is the data that becomes nodes in the graph.

Also query total confessions in DB for the ratio stat:

```js
supabase
    .from('confessions')
    .select('id', { count: 'exact', head: true })
    .eq('is_deleted', false)
```

---

## File Structure

Create these files:

```
src/components/BlockchainCard.jsx
src/components/BlockchainCard.module.css
src/components/BlockchainGraph.jsx
src/components/BlockchainGraph.module.css
```

Modify:
```
src/App.jsx or the authenticated layout shell  ← add BlockchainCard to right sidebar
```

---

## Part 1: BlockchainCard

### Layout

```
┌─────────────────────────────┐
│  ⛓  Blockchain              │
│                             │
│  ●●●  (mini node preview)   │
│                             │
│  12 confessions on-chain    │
│  89% of total               │
│                             │
│  Click to explore →         │
└─────────────────────────────┘
```

- Width: 100% of the right sidebar (right sidebar should be ~280px)
- Background: `colors.surface`
- Border: 1px solid `colors.border`
- Border-radius: 12px
- Padding: 20px
- Cursor: pointer
- On hover: border color transitions to `colors.primary`, box-shadow lifts slightly (0.2s ease)

### Mini node preview

A tiny inline SVG inside the card (width: 100%, height: 48px) showing a preview of the first 5 nodes connected in a chain. This is purely decorative — small circles connected by lines, colored in `colors.primary` at low opacity. Not interactive.

```
● — ● — ● — ● — ● →
```

Nodes are evenly spaced horizontally, vertically centered in the 48px height. If there are fewer than 5 on-chain records, show however many exist. If zero, show a dashed line with a single empty circle and text "Waiting for first confession...".

### Stats

- Line 1: `{count} confession{count !== 1 ? 's' : ''} on blockchain` — 15px bold, `colors.textPrimary`
- Line 2: `{percentage}% of total confessions` — 13px, `colors.textSecondary`
- Line 3: `Click to explore →` — 13px, `colors.primary`, italic

### Props

```js
// BlockchainCard accepts no props — manages its own data fetching
// Calls setIsGraphOpen(true) on click to open the overlay
```

### State

```js
const [records, setRecords] = useState([]);      // blockchain_sync_log rows
const [totalConfessions, setTotalConfessions] = useState(0);
const [isGraphOpen, setIsGraphOpen] = useState(false);
```

---

## Part 2: BlockchainGraph

### Trigger

Rendered as a full screen overlay when `isGraphOpen` is true. Passed down from BlockchainCard as a prop, or managed with a shared state in the parent layout.

### Full Screen Overlay Layout

```
┌────────────────────────────────────────────────────────────┐
│  ✕  (close button top-right)                               │
│                                                            │
│  Blockchain  (heading top-left, primary color)             │
│  12 confessions permanently recorded                       │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │   ●━━━●━━━●━━━●━━━●━━━●━━━●  (animated SVG chain)   │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  [hovered node tooltip: tx hash, timestamp]                │
└────────────────────────────────────────────────────────────┘
```

- Overlay: fixed position, full viewport (100vw x 100vh), z-index 1000
- Background: `rgba(28, 25, 23, 0.95)` (near-black, very slightly warm)
- Close button: top-right, 40x40px, white X icon, ghost style. Also closes on Escape key press and backdrop click.
- Heading: "Blockchain" in 28px bold, `colors.primary`
- Subheading: "{count} confessions permanently recorded" in 15px `colors.textMuted`

### SVG Graph — Chain Layout

The SVG fills the center of the overlay. Use `width: 100%` and a `viewBox` that scales with the number of nodes.

**Node positioning — flowing wave layout:**

Nodes are arranged left to right in a gentle sine wave pattern so it doesn't look like a flat line:

```js
const NODE_RADIUS = 14;
const H_SPACING = 90;       // horizontal gap between node centers
const WAVE_AMPLITUDE = 40;  // how much the wave oscillates vertically
const WAVE_FREQUENCY = 0.4; // how many full waves across the graph

// For each node at index i:
const x = 60 + i * H_SPACING;
const y = centerY + Math.sin(i * WAVE_FREQUENCY) * WAVE_AMPLITUDE;
```

The SVG viewBox width = `60 + nodes.length * H_SPACING + 60` (60px padding each side).
The SVG viewBox height = `200` (fixed, enough for the wave to move within).

**Connecting lines:**

Draw an SVG `<line>` between each consecutive pair of nodes. Style:
- Stroke: `colors.primary` at 40% opacity
- Stroke-width: 2
- Stroke-dasharray: `6 4` (dashed line to look like a blockchain link)
- Animated: apply a CSS animation `dashMove` that shifts the `stroke-dashoffset` so the dashes appear to flow from left to right continuously

```css
@keyframes dashMove {
    to { stroke-dashoffset: -20; }
}
.chainLine {
    stroke-dasharray: 6 4;
    animation: dashMove 1.5s linear infinite;
}
```

**Nodes:**

Each node is an SVG `<circle>` with:
- Radius: 14
- Fill: `colors.primary` at 80% opacity
- Stroke: `colors.primary`, stroke-width: 2
- CSS animation: `pulse` — gently scales between 1.0 and 1.15 and back, ease-in-out, 2s infinite, each node offset by `i * 0.3s` delay so they don't all pulse together

```css
@keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 0.85; }
    50%       { transform: scale(1.15); opacity: 1; }
}
```

**IMPORTANT:** SVG transforms on circles need `transform-origin` set to the circle's center. Use `transform-box: fill-box` and `transform-origin: center` in CSS to ensure the pulse animation scales from the node's center, not from (0,0).

**Node entry animation:**

When a new node is added (via Realtime), it should animate in:
- Start: opacity 0, scale 0
- End: opacity 1, scale 1
- Duration: 0.5s ease-out

Use a CSS class `.nodeEnter` applied for 500ms then removed. Track which nodes are "new" with a `useState` set.

**Newest node:**

The last node in the chain gets special treatment:
- Radius: 18 (slightly larger)
- A second outer circle at radius 26, filled transparent, stroked `colors.primary` at 30% opacity, with its own slower pulse animation (`ripple`)
- This creates a "ripple" effect on the latest addition

```css
@keyframes ripple {
    0%   { r: 18; opacity: 0.6; }
    100% { r: 32; opacity: 0; }
}
```

**Hover tooltip:**

On `onMouseEnter` of a node circle, show a tooltip:

```
┌─────────────────────────────────┐
│  Confession #7                  │
│  2026-04-17 19:02               │
│  0x3760...fc9 ↗                 │
└─────────────────────────────────┘
```

- Position: floating div absolutely positioned near the hovered node
- Background: `colors.surface`
- Border: 1px solid `colors.border`
- Border-radius: 8px
- Padding: 10px 14px
- Shadow: `colors.shadowMd`
- Line 1: "Confession #N" where N is the index + 1, bold
- Line 2: formatted date (not raw ISO — use `new Date(synced_at).toLocaleString()`)
- Line 3: truncated tx_hash (first 6 chars + "..." + last 4 chars) as a link to `https://sepolia.etherscan.io/tx/{full_tx_hash}` — opens in new tab

On `onMouseLeave` hide the tooltip.

---

## Part 3: Supabase Realtime

In `BlockchainGraph`, after the initial data fetch, subscribe to new confirmed blockchain sync log entries:

```js
const channel = supabase
    .channel('blockchain-graph')
    .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'blockchain_sync_log',
        filter: 'status=eq.confirmed',
    }, (payload) => {
        if (payload.new.entity_type === 'confession') {
            setRecords(prev => [...prev, payload.new]);
            // Mark as new for entry animation
            setNewNodeIds(prev => new Set([...prev, payload.new.id]));
            setTimeout(() => {
                setNewNodeIds(prev => {
                    const next = new Set(prev);
                    next.delete(payload.new.id);
                    return next;
                });
            }, 500);
        }
    })
    .subscribe();

return () => supabase.removeChannel(channel);
```

Also unsubscribe when the graph overlay is closed (component unmounts or isOpen becomes false).

---

## Part 4: Add to Layout

In the authenticated layout (wherever Sidebar is rendered alongside the main content), add a right sidebar column:

```jsx
<div className={styles.appLayout}>
    <Sidebar />
    <main className={styles.mainContent}>
        {children / outlet}
    </main>
    <aside className={styles.rightSidebar}>
        <BlockchainCard />
    </aside>
</div>
```

Right sidebar styles:
- Width: 280px
- Padding: 20px 16px
- Hidden on screens narrower than 1100px (use a CSS media query — not required since app is desktop only, but good practice)
- Position: sticky, top: 0, height: 100vh, overflow-y: auto

---

## Styling Rules

- All colors from `src/config/colors.js` — never hardcode hex values EXCEPT for the overlay background `rgba(28, 25, 23, 0.95)` which is a one-off transparency value
- CSS Modules for both components (`.module.css`)
- SVG inline in JSX — no external SVG files
- Animations defined in CSS Module files using `@keyframes`
- Font: inherited from global (Inter)
- No new npm packages — use only what's already installed

---

## Empty State

If `records.length === 0` (no confessions on-chain yet):

**Card:** Show the dashed preview line with an empty circle and text "Waiting for first confession on blockchain..."

**Graph overlay:** Show a centered message:
- Large chain link icon (SVG inline, ~64px)
- "No confessions on blockchain yet"
- "Post a confession and check 'Add to blockchain' to see it appear here"
- In `colors.textMuted`, centered

---

## Error Handling

Wrap the Supabase query in try/catch. If the query fails:
- Card shows "Blockchain data unavailable" in `colors.textMuted`
- No crash

---

## Summary

| File | Action |
|------|--------|
| `src/components/BlockchainCard.jsx` | CREATE |
| `src/components/BlockchainCard.module.css` | CREATE |
| `src/components/BlockchainGraph.jsx` | CREATE |
| `src/components/BlockchainGraph.module.css` | CREATE |
| Authenticated layout shell | MODIFY — add right sidebar with BlockchainCard |

Do NOT modify:
- `src/config/colors.js`
- `src/config/supabase.js`
- Any files in `src/security/`
- Any blockchain service logic
- The database schema
