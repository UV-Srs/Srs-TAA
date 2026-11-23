/**
 * TAA Inspection Management System - Real-time Live Synchronization Engine
 * Connects via WebSocket (/ws/live) to receive instant updates across Admin,
 * Supervisor, and Operator workspaces without requiring page refreshes.
 */

type LiveEventHandler = (data: any) => void;

class LiveSyncClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<LiveEventHandler>> = new Map();
  private reconnectTimeout: number | null = null;
  private pingInterval: number | null = null;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;

  constructor() {
    this.connect();
  }

  public connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const token = localStorage.getItem('taa_jwt_token');
    if (!token) {
      // Not logged in yet — don't attempt a connection that will be rejected.
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:8000';
    const wsUrl = `${protocol}//${host}/ws/live?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        // console.log('[LiveSync] Real-time live connection established.');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type && payload.type !== 'pong') {
            this.dispatch(payload.type, payload.data);
          }
        } catch (e) {
          console.warn('[LiveSync] Message parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 2500);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public subscribe(eventType: string, handler: LiveEventHandler): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);

    // Return un-subscriber
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  private dispatch(eventType: string, data: any) {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.warn(`[LiveSync] Error in listener for ${eventType}:`, err);
        }
      });
    }

    // Also dispatch to wildcard listeners
    const wildcard = this.listeners.get('*');
    if (wildcard) {
      wildcard.forEach((fn) => fn({ type: eventType, data }));
    }
  }

  public getStatus(): boolean {
    return this.isConnected;
  }

  public reconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.stopHeartbeat();
    this.connect();
  }
}

export const liveSync = new LiveSyncClient();

// Helper subscription functions
export function onSheetUpdated(handler: (data: { sheet_id: string; action: string }) => void) {
  return liveSync.subscribe('SHEET_UPDATED', handler);
}

export function onBatchUpdated(handler: (data: { batch_id: number; status: string; round?: number; supervisor_reviews?: any }) => void) {
  return liveSync.subscribe('BATCH_UPDATED', handler);
}

export function onBatchCreated(handler: (data: { batch_id: number; sheet_id: string; lot_number: string }) => void) {
  return liveSync.subscribe('BATCH_CREATED', handler);
}

export function onCellUpdated(handler: (data: {
  batch_id: number;
  item_id: number;
  column_key: string;
  cell_value: any;
  is_within_spec: boolean;
  checker_initials?: string;
  updated_at: string;
}) => void) {
  return liveSync.subscribe('CELL_UPDATED', handler);
}

export function onNotificationDispatched(handler: (data: any) => void) {
  return liveSync.subscribe('NOTIFICATION_DISPATCHED', handler);
}

export function onScanResolved(handler: (data: {
  batch_id: number;
  sheet_id: string;
  lot_number: string;
  status: string;
  user_id: number;
  role: string;
}) => void) {
  return liveSync.subscribe('SCAN_RESOLVED', handler);
}

export function onScanNotFound(handler: (data: {
  raw_code: string;
  format_detected: string;
  suggested_sheet_id: string | null;
  part_no: string | null;
  part_name: string | null;
  vendor: string | null;
  customer: string | null;
  model: string | null;
  lot_number: string | null;
  gtin: string | null;
  user_id: number;
  role: string;
}) => void) {
  return liveSync.subscribe('SCAN_NOT_FOUND', handler);
}
