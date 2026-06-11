// quick.js – the zero-config OpenQuick browser SDK.
// Served by the platform worker at <site>/__quick.js. Just include it:
//   <script src="__quick.js"></script>
// and window.quick gives you a database, realtime, files, AI and channels.

type Doc = Record<string, unknown> & { id: string; createdAt: number; updatedAt: number };
type DbHandlers = { onCreate?: (doc: Doc) => void; onUpdate?: (doc: Doc) => void; onDelete?: (id: string) => void };
type From = { cid: string; name: string | null };
type PresenceEvent = { ev: 'join' | 'leave' | 'you'; who: From; members: From[] };

(() => {
  // ---------- base detection ----------
  const override = (window as never as { __QUICK_BASE__?: string }).__QUICK_BASE__;
  let base: string;
  if (override) {
    base = override.replace(/\/$/, '');
  } else {
    const script = document.currentScript as HTMLScriptElement | null;
    const src = script?.src ?? `${location.origin}/__quick.js`;
    base = src.replace(/\/__quick\.js.*$/, '');
  }
  const api = `${base}/__api`;
  const storeKey = (k: string) => `oq:${new URL(base, location.href).pathname}:${k}`;

  // ---------- helpers ----------
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${api}${path}`, init);
    if (!res.ok) {
      let message = `${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        /* not json */
      }
      throw new Error(`quick: ${message}`);
    }
    return res.json() as Promise<T>;
  }
  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // ---------- realtime socket (single multiplexed connection) ----------
  const subs = new Map<string, Set<DbHandlers>>();
  type ChanHandlers = { message: Set<(data: unknown, from: From) => void>; presence: Set<(e: PresenceEvent) => void> };
  const chans = new Map<string, ChanHandlers>();
  let ws: WebSocket | null = null;
  let wsReady = false;
  let queue: string[] = [];
  let retry = 0;
  let myCid: string | null = null;

  function wsSend(msg: Record<string, unknown>) {
    const text = JSON.stringify(msg);
    if (wsReady && ws) ws.send(text);
    else {
      queue.push(text);
      ensureSocket();
    }
  }

  function ensureSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const wsUrl = api.replace(/^http/, 'ws') + '/ws';
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      wsReady = true;
      retry = 0;
      const name = localStorage.getItem(storeKey('name'));
      if (name) ws!.send(JSON.stringify({ t: 'name', name }));
      for (const col of subs.keys()) ws!.send(JSON.stringify({ t: 'sub', col }));
      for (const ch of chans.keys()) ws!.send(JSON.stringify({ t: 'join', ch, name }));
      for (const text of queue) ws!.send(text);
      queue = [];
    };
    ws.onmessage = (event) => {
      let msg: { t: string; [k: string]: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.t === 'hello') myCid = msg.cid as string;
      if (msg.t === 'db') {
        const handlers = subs.get(msg.col as string);
        if (!handlers) return;
        for (const h of handlers) {
          if (msg.ev === 'create') h.onCreate?.(msg.doc as Doc);
          else if (msg.ev === 'update') h.onUpdate?.(msg.doc as Doc);
          else if (msg.ev === 'delete') h.onDelete?.(msg.id as string);
        }
      }
      if (msg.t === 'msg') {
        const c = chans.get(msg.ch as string);
        c?.message.forEach((h) => h(msg.data, msg.from as From));
      }
      if (msg.t === 'presence') {
        const c = chans.get(msg.ch as string);
        c?.presence.forEach((h) =>
          h({ ev: msg.ev as PresenceEvent['ev'], who: msg.who as From, members: msg.members as From[] }),
        );
      }
    };
    ws.onclose = () => {
      wsReady = false;
      if (subs.size || chans.size || queue.length) {
        setTimeout(ensureSocket, Math.min(1000 * 2 ** retry++, 15000));
      }
    };
    ws.onerror = () => ws?.close();
  }

  // ---------- quick.db ----------
  function collection(name: string) {
    const col = encodeURIComponent(name);
    return {
      async create(doc: Record<string, unknown> = {}): Promise<Doc> {
        return call(`/db/${col}`, jsonInit('POST', doc));
      },
      async get(id: string): Promise<Doc> {
        return call(`/db/${col}/${encodeURIComponent(id)}`);
      },
      async list(
        opts: { limit?: number; offset?: number; order?: 'asc' | 'desc'; filter?: Record<string, unknown> } = {},
      ): Promise<Doc[]> {
        const q = new URLSearchParams();
        if (opts.limit) q.set('limit', String(opts.limit));
        if (opts.offset) q.set('offset', String(opts.offset));
        if (opts.order) q.set('order', opts.order);
        if (opts.filter) q.set('filter', JSON.stringify(opts.filter));
        const { docs } = await call<{ docs: Doc[] }>(`/db/${col}?${q}`);
        return docs;
      },
      async update(id: string, patch: Record<string, unknown>): Promise<Doc> {
        return call(`/db/${col}/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
      },
      async delete(id: string): Promise<void> {
        await call(`/db/${col}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
      subscribe(handlers: DbHandlers): () => void {
        let set = subs.get(name);
        if (!set) {
          set = new Set();
          subs.set(name, set);
          wsSend({ t: 'sub', col: name });
        }
        set.add(handlers);
        return () => {
          set!.delete(handlers);
          if (set!.size === 0) {
            subs.delete(name);
            wsSend({ t: 'unsub', col: name });
          }
        };
      },
    };
  }

  // ---------- quick.channel ----------
  function channel(name: string) {
    let c = chans.get(name);
    if (!c) {
      c = { message: new Set(), presence: new Set() };
      chans.set(name, c);
      wsSend({ t: 'join', ch: name, name: localStorage.getItem(storeKey('name')) });
    }
    const handlers = c;
    return {
      send(data: unknown) {
        wsSend({ t: 'pub', ch: name, data });
      },
      on(event: 'message' | 'presence', handler: (...args: never[]) => void): () => void {
        const set = event === 'message' ? handlers.message : handlers.presence;
        set.add(handler as never);
        return () => set.delete(handler as never);
      },
      leave() {
        chans.delete(name);
        wsSend({ t: 'leave', ch: name });
      },
    };
  }

  // ---------- quick.files ----------
  const files = {
    async upload(file: Blob, name?: string): Promise<{ id: string; url: string; name: string; size: number; type: string }> {
      const fileName = name ?? (file instanceof File ? file.name : 'file');
      const res = await call<{ id: string; url: string; name: string; size: number; type: string }>(
        `/files?name=${encodeURIComponent(fileName)}`,
        { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file },
      );
      return { ...res, url: new URL(res.url, location.origin).toString() };
    },
  };

  // ---------- quick.ai ----------
  type Message = { role: 'system' | 'user' | 'assistant'; content: string };
  const ai = {
    async chat(
      input: string | Message[],
      opts: { model?: string; system?: string; onToken?: (token: string) => void } = {},
    ): Promise<string> {
      const body: Record<string, unknown> = {
        model: opts.model,
        system: opts.system,
        ...(typeof input === 'string' ? { prompt: input } : { messages: input }),
      };
      if (!opts.onToken) {
        const { content } = await call<{ content: string }>('/ai/chat', jsonInit('POST', body));
        return content;
      }
      const res = await fetch(`${api}/ai/chat`, jsonInit('POST', { ...body, stream: true }));
      if (!res.ok || !res.body) throw new Error(`quick: ai error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const token = (JSON.parse(payload) as { response?: string }).response ?? '';
            if (token) {
              full += token;
              opts.onToken(token);
            }
          } catch {
            /* partial frame */
          }
        }
      }
      return full;
    },
    async image(prompt: string, opts: { model?: string } = {}): Promise<{ blob: Blob; url: string }> {
      const res = await fetch(`${api}/ai/image`, jsonInit('POST', { prompt, model: opts.model }));
      if (!res.ok) {
        let message = `${res.status}`;
        try {
          message = ((await res.json()) as { error?: string }).error ?? message;
        } catch {
          /* not json */
        }
        throw new Error(`quick: ${message}`);
      }
      const blob = await res.blob();
      return { blob, url: URL.createObjectURL(blob) };
    },
  };

  // ---------- quick.id ----------
  let identityCache: { email?: string } | null = null;
  async function id(): Promise<{ id: string; name: string | null; email?: string }> {
    let uid = localStorage.getItem(storeKey('uid'));
    if (!uid) {
      uid = crypto.randomUUID();
      localStorage.setItem(storeKey('uid'), uid);
    }
    if (identityCache === null) {
      try {
        identityCache = await call<{ email?: string }>('/identity');
      } catch {
        identityCache = {};
      }
    }
    return { id: uid, name: localStorage.getItem(storeKey('name')), ...identityCache };
  }
  id.setName = (name: string) => {
    localStorage.setItem(storeKey('name'), name.slice(0, 32));
    wsSend({ t: 'name', name: name.slice(0, 32) });
  };

  // ---------- export ----------
  const quick = {
    base,
    db: { collection },
    channel,
    files,
    ai,
    id,
    get cid() {
      return myCid;
    },
  };
  (window as never as { quick: typeof quick }).quick = quick;
})();
