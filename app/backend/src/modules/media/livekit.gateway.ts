import { RoomServiceClient } from 'livekit-server-sdk';
import type { MediaGateway } from './gateway.interface.js';

export class LiveKitGateway implements MediaGateway {
  private client: RoomServiceClient;
  constructor(url: string, apiKey: string, apiSecret: string) {
    this.client = new RoomServiceClient(url, apiKey, apiSecret);
  }
  async ensureRoom(roomId: string, maxPeers: number): Promise<void> {
    await this.client.createRoom({ name: roomId, emptyTimeout: 600, maxParticipants: maxPeers });
  }
  async removeParticipant(roomId: string, identity: string): Promise<void> {
    await this.client.removeParticipant(roomId, identity);
  }
  async setParticipantMuted(roomId: string, identity: string, muted: boolean): Promise<void> {
    await this.client.mutePublishedTrack(roomId, identity, '', muted);
  }
  async endRoom(roomId: string): Promise<void> {
    await this.client.deleteRoom(roomId);
  }
}

// Test double — records calls, no network.
export class FakeGateway implements MediaGateway {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  async ensureRoom(roomId: string, maxPeers: number): Promise<void> {
    this.calls.push({ method: 'ensureRoom', args: [roomId, maxPeers] });
  }
  async removeParticipant(roomId: string, identity: string): Promise<void> {
    this.calls.push({ method: 'removeParticipant', args: [roomId, identity] });
  }
  async setParticipantMuted(roomId: string, identity: string, muted: boolean): Promise<void> {
    this.calls.push({ method: 'setParticipantMuted', args: [roomId, identity, muted] });
  }
  async endRoom(roomId: string): Promise<void> {
    this.calls.push({ method: 'endRoom', args: [roomId] });
  }
}
