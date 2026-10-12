// Chat's live connection: one WebSocket to /api/chat/ws (the favor-chat Worker's ChatRoom), a ping every 30 seconds, reconnect with
// backoff, a 20 second poll while the socket is down, a resync after any reconnect, presence (away and online) on tab hide and show,
// and a dead-socket check when a tab comes back after 10 seconds hidden. The same rules as public/js/chat/chat.js.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Ev = Record<string, any>;

export class ChatSocket {
  private ws: WebSocket | null = null;
  private pingT: ReturnType<typeof setInterval> | undefined;
  private pollT: ReturnType<typeof setInterval> | undefined;
  private retryT: ReturnType<typeof setTimeout> | undefined;
  private checkT: ReturnType<typeof setTimeout> | undefined;
  private retry = 0;
  private everOpen = false;
  private lastSeen = Date.now();
  private hiddenAt = 0;
  private on = false;
  constructor(private emit: (ev: Ev) => void) {}

  start() {
    if (this.on) return;
    this.on = true;
    document.addEventListener('visibilitychange', this.vis);
    addEventListener('online', this.online);
    addEventListener('offline', this.offline);
    this.connect();
  }
  stop() {
    this.on = false;
    document.removeEventListener('visibilitychange', this.vis);
    removeEventListener('online', this.online);
    removeEventListener('offline', this.offline);
    clearInterval(this.pingT);
    clearInterval(this.pollT);
    clearTimeout(this.retryT);
    clearTimeout(this.checkT);
    this.pollT = undefined;
    const w = this.ws;
    this.ws = null;
    if (w) {
      w.onclose = null;
      try {
        w.close();
      } catch {
        // gone
      }
    }
  }
  get open() {
    return !!this.ws && this.ws.readyState === 1;
  }

  private connect() {
    if (!this.on) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat/ws');
    } catch {
      this.fallback();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      clearInterval(this.pingT);
      clearInterval(this.pollT);
      this.pollT = undefined;
      this.pingT = setInterval(() => {
        if (ws.readyState === 1) ws.send('ping');
      }, 30000);
      if (document.hidden) ws.send(JSON.stringify({ t: 'p', s: 'away' }));
      this.emit({ type: 'conn', ok: true });
      if (this.everOpen || Date.now() - this.lastSeen > 20000) this.emit({ type: 'resync' });
      this.everOpen = true;
    };
    ws.onmessage = (e) => {
      this.lastSeen = Date.now();
      clearTimeout(this.checkT);
      if (e.data === 'pong') return;
      try {
        this.emit(JSON.parse(e.data));
      } catch {
        // not ours
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingT);
      if (this.ws === ws) this.ws = null;
      if (!this.on) return;
      this.emit({ type: 'conn', ok: false });
      this.retry = Math.min(this.retry + 1, 6);
      clearTimeout(this.retryT);
      this.retryT = setTimeout(() => this.connect(), this.retry <= 1 ? 250 : Math.min(30000, 800 * Math.pow(2, this.retry)));
      this.fallback();
    };
    ws.onerror = () => undefined;
  }
  private fallback() {
    if (this.pollT) return;
    this.pollT = setInterval(() => {
      if (!document.hidden) this.emit({ type: 'resync' });
    }, 20000);
  }
  /** A phone that was locked can hold a socket that looks open and carries nothing: ask for a pong, and open a new socket without one. */
  private check() {
    if (!this.ws || this.ws.readyState !== 1) {
      this.connect();
      return;
    }
    clearTimeout(this.checkT);
    try {
      this.ws.send('ping');
    } catch {
      // closing
    }
    this.checkT = setTimeout(() => {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.close();
        } catch {
          // gone
        }
      }
    }, 4000);
  }
  private vis = () => {
    if (document.hidden) this.hiddenAt = Date.now();
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'p', s: document.hidden ? 'away' : 'online' }));
    if (document.hidden) return;
    if (!this.ws || this.ws.readyState !== 1) {
      this.retry = 0;
      this.connect();
      return;
    }
    if (this.hiddenAt && Date.now() - this.hiddenAt > 10000) this.check();
  };
  private online = () => {
    this.retry = 0;
    this.check();
  };
  private offline = () => this.emit({ type: 'conn', ok: false });
}
