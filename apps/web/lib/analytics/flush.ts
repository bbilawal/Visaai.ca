export interface ClientEvent {
  event_id: string;
  name: string;
  occurred_at: string;
  anonymous_id: string | null;
  session_id: string | null;
  props: Record<string, string | number | boolean | null>;
}

export class EventBuffer {
  private buf: ClientEvent[] = [];

  constructor(private readonly cap = 50) {}

  add(e: ClientEvent): void {
    this.buf.push(e);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  drain(): ClientEvent[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  get size(): number {
    return this.buf.length;
  }
}
