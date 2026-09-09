import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';

// Presence + fan-out abstraction. Redis in prod (shared across instances),
// in-process EventEmitter in tests / single-node dev.
export interface PresenceBus {
  publish(roomId: string, event: string): Promise<void>;
  subscribe(handler: (roomId: string, event: string) => void): void;
  setOnline(roomId: string, userId: string, ttlSec: number): Promise<void>;
  removeOnline(roomId: string, userId: string): Promise<void>;
  onlineCount(roomId: string): Promise<number>;
  close(): Promise<void>;
}

export class MemoryPresenceBus implements PresenceBus {
  private emitter = new EventEmitter();
  private online = new Map<string, Set<string>>();
  async publish(roomId: string, event: string): Promise<void> {
    this.emitter.emit('msg', roomId, event);
  }
  subscribe(handler: (roomId: string, event: string) => void): void {
    this.emitter.on('msg', handler);
  }
  async setOnline(roomId: string, userId: string, _ttlSec?: number): Promise<void> {
    let s = this.online.get(roomId);
    if (!s) {
      s = new Set();
      this.online.set(roomId, s);
    }
    s.add(userId);
  }
  async removeOnline(roomId: string, userId: string): Promise<void> {
    this.online.get(roomId)?.delete(userId);
  }
  async onlineCount(roomId: string): Promise<number> {
    return this.online.get(roomId)?.size ?? 0;
  }
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

export class RedisPresenceBus implements PresenceBus {
  private pub: Redis;
  private sub: Redis;
  private handler: ((roomId: string, event: string) => void) | null = null;

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.sub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    void this.sub.subscribe('voice-room').catch(() => undefined);
    this.sub.on('message', (_channel, raw) => {
      try {
        const { roomId, event } = JSON.parse(raw) as { roomId: string; event: string };
        this.handler?.(roomId, event);
      } catch {
        /* ignore malformed */
      }
    });
  }
  private key(roomId: string): string {
    return `voice-room:online:${roomId}`;
  }
  async publish(roomId: string, event: string): Promise<void> {
    await this.pub.publish('voice-room', JSON.stringify({ roomId, event }));
  }
  subscribe(handler: (roomId: string, event: string) => void): void {
    this.handler = handler;
  }
  async setOnline(roomId: string, userId: string, ttlSec: number): Promise<void> {
    const pipe = this.pub.pipeline();
    pipe.sadd(this.key(roomId), userId);
    pipe.expire(this.key(roomId), ttlSec);
    await pipe.exec();
  }
  async removeOnline(roomId: string, userId: string): Promise<void> {
    await this.pub.srem(this.key(roomId), userId);
  }
  async onlineCount(roomId: string): Promise<number> {
    return this.pub.scard(this.key(roomId));
  }
  async close(): Promise<void> {
    this.sub.disconnect();
    this.pub.disconnect();
  }
}
