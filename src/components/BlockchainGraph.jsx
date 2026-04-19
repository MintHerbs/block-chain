import { useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import styles from './BlockchainGraph.module.css';

export default function BlockchainGraph({ isOpen, onClose, initialRecords, highlightEntityId }) {
  const [records, setRecords] = useState(initialRecords || []);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [newNodeIds, setNewNodeIds] = useState(new Set());
  const [expandedNode, setExpandedNode] = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Subscribe to new blockchain records
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(e) {
      if (e.key === 'Escape') onClose();
    }
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Tree-like branching layout algorithm
  function calculateNodePositions() {
    if (records.length === 0) return [];
    
    const positions = [];
    const LEVEL_HEIGHT = 120;
    const BASE_H_SPACING = 100;
    const BRANCH_ANGLE = 0.6; // radians for branch spread
    
    // Calculate tree structure - nodes branch out as they grow
    records.forEach((record, i) => {
      let x, y;
      
      if (i === 0) {
        // Root node - centered at top
        x = 400;
        y = 80;
      } else {
        // Calculate level (row) and position within level
        const level = Math.floor(Math.log2(i + 1));
        const posInLevel = i - (Math.pow(2, level) - 1);
        const nodesInLevel = Math.pow(2, level);
        
        // Parent node index
        const parentIndex = Math.floor((i - 1) / 2);
        const parentPos = positions[parentIndex];
        
        // Determine if left or right child
        const isLeftChild = i % 2 === 1;
        
        // Calculate horizontal spread that decreases with depth
        const spreadFactor = Math.max(0.3, 1 - level * 0.15);
        const horizontalOffset = BASE_H_SPACING * spreadFactor;
        
        x = parentPos.x + (isLeftChild ? -horizontalOffset : horizontalOffset);
        y = 80 + level * LEVEL_HEIGHT;
        
        // Add slight wave variation for organic feel
        x += Math.sin(i * 0.5) * 15;
      }
      
      positions.push({ x, y, record, index: i });
    });
    
    return positions;
  }

  const nodePositions = calculateNodePositions();
  
  // Calculate viewBox to fit all nodes
  const padding = 100;
  const minX = Math.min(...nodePositions.map(p => p.x), 0) - padding;
  const maxX = Math.max(...nodePositions.map(p => p.x), 800) + padding;
  const minY = 0;
  const maxY = Math.max(...nodePositions.map(p => p.y), 400) + padding;
  const viewBoxWidth = maxX - minX;
  const viewBoxHeight = maxY - minY;

  function handleNodeMouseEnter(record, index, event) {
    const svgRect = svgRef.current.getBoundingClientRect();
    const nodePos = nodePositions.find(p => p.index === index);
    if (!nodePos) return;
    
    // Convert SVG coordinates to screen coordinates
    const scaleX = svgRect.width / viewBoxWidth;
    const scaleY = svgRect.height / viewBoxHeight;
    
    setTooltipPos({
      x: svgRect.left + (nodePos.x - minX) * scaleX,
      y: svgRect.top + (nodePos.y - minY) * scaleY
    });
    setHoveredNode(record);
  }

  function handleNodeMouseLeave() {
    setHoveredNode(null);
  }

  function handleNodeClick(record, index) {
    setExpandedNode(expandedNode?.id === record.id ? null : record);
  }

  const NODE_RADIUS = 14;

  function formatTxHash(hash) {
    if (!hash) return '';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleString();
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className={styles.header}>
          <h1 className={styles.title}>Blockchain</h1>
          <p className={styles.subtitle}>
            {records.length} confession{records.length !== 1 ? 's' : ''} permanently recorded
          </p>
        </div>

        {records.length === 0 ? (
          <div className={styles.emptyState}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="20" cy="32" r="8" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <circle cx="44" cy="32" r="8" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <line x1="28" y1="32" x2="36" y2="32" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" opacity="0.3" />
            </svg>
            <p className={styles.emptyTitle}>No confessions on blockchain yet</p>
            <p className={styles.emptyText}>
              Post a confession and check 'Add to blockchain' to see it appear here
            </p>
          </div>
        ) : (
          <div className={styles.graphContainer}>
            <svg 
              ref={svgRef}
              width="100%" 
              height="500" 
              viewBox={`${minX} ${minY} ${viewBoxWidth} ${viewBoxHeight}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Draw connecting lines from parent to children */}
              {nodePositions.map((nodePos, i) => {
                if (i === 0) return null; // Root has no parent
                
                const parentIndex = Math.floor((i - 1) / 2);
                const parentPos = nodePositions[parentIndex];
                
                return (
                  <line
                    key={`line-${nodePos.record.id}`}
                    x1={parentPos.x}
                    y1={parentPos.y}
                    x2={nodePos.x}
                    y2={nodePos.y}
                    className={styles.chainLine}
                  />
                );
              })}

              {/* Draw nodes */}
              {nodePositions.map((nodePos) => {
                const isNewest = nodePos.index === records.length - 1;
                const isNew = newNodeIds.has(nodePos.record.id);
                const isExpanded = expandedNode?.id === nodePos.record.id;
                const isHighlighted = highlightEntityId && nodePos.record.entity_id === highlightEntityId;
                
                return (
                  <g key={nodePos.record.id}>
                    {/* Ripple effect for newest node */}
                    {isNewest && (
                      <circle
                        cx={nodePos.x}
                        cy={nodePos.y}
                        r="18"
                        className={styles.ripple}
                      />
                    )}
                    
                    {/* Expanded highlight ring */}
                    {isExpanded && (
                      <circle
                        cx={nodePos.x}
                        cy={nodePos.y}
                        r="24"
                        className={styles.expandedRing}
                      />
                    )}
                    
                    {/* Highlighted node ring (green for blockchain confessions) */}
                    {isHighlighted && (
                      <circle
                        cx={nodePos.x}
                        cy={nodePos.y}
                        r="26"
                        className={styles.highlightRing}
                      />
                    )}
                    
                    {/* Main node */}
                    <circle
                      cx={nodePos.x}
                      cy={nodePos.y}
                      r={isNewest ? 18 : NODE_RADIUS}
                      className={`${styles.node} ${isNew ? styles.nodeEnter : ''} ${isExpanded ? styles.nodeExpanded : ''} ${isHighlighted ? styles.nodeHighlighted : ''}`}
                      style={{ animationDelay: `${nodePos.index * 0.3}s` }}
                      onMouseEnter={(e) => handleNodeMouseEnter(nodePos.record, nodePos.index, e)}
                      onMouseLeave={handleNodeMouseLeave}
                      onClick={() => handleNodeClick(nodePos.record, nodePos.index)}
                    />
                    
                    {/* Node label - confession number */}
                    <text
                      x={nodePos.x}
                      y={nodePos.y + 35}
                      className={styles.nodeLabel}
                      textAnchor="middle"
                    >
                      #{nodePos.index + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Expanded node details panel */}
        {expandedNode && (
          <div className={styles.detailsPanel}>
            <div className={styles.detailsHeader}>
              <h3 className={styles.detailsTitle}>
                Confession #{records.findIndex(r => r.id === expandedNode.id) + 1}
              </h3>
              <button 
                className={styles.detailsClose}
                onClick={() => setExpandedNode(null)}
              >
                ✕
              </button>
            </div>
            
            <div className={styles.detailsContent}>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Entity ID:</span>
                <span className={styles.detailValue}>{expandedNode.entity_id}</span>
              </div>
              
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Synced At:</span>
                <span className={styles.detailValue}>{formatDate(expandedNode.synced_at)}</span>
              </div>
              
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Transaction Hash:</span>
                <a 
                  href={`https://sepolia.etherscan.io/tx/${expandedNode.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.detailLink}
                >
                  {expandedNode.tx_hash}
                </a>
              </div>
              
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Status:</span>
                <span className={styles.detailBadge}>Confirmed on Sepolia</span>
              </div>
              
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Position in Chain:</span>
                <span className={styles.detailValue}>
                  {records.findIndex(r => r.id === expandedNode.id) + 1} of {records.length}
                </span>
              </div>
            </div>
            
            <a 
              href={`https://sepolia.etherscan.io/tx/${expandedNode.tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.detailsButton}
            >
              View on Etherscan ↗
            </a>
          </div>
        )}

        {/* Tooltip */}
        {hoveredNode && (
          <div 
            className={styles.tooltip}
            style={{
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y - 80}px`
            }}
          >
            <p className={styles.tooltipTitle}>
              Confession #{records.findIndex(r => r.id === hoveredNode.id) + 1}
            </p>
            <p className={styles.tooltipDate}>
              {formatDate(hoveredNode.synced_at)}
            </p>
            <a 
              href={`https://sepolia.etherscan.io/tx/${hoveredNode.tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.tooltipLink}
            >
              {formatTxHash(hoveredNode.tx_hash)} ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
