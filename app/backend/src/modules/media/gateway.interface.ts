// Media Gateway Adapter — thin, swappable boundary around the SFU server API.
// Business logic depends ONLY on this interface, never on the LiveKit SDK directly.
export interface MediaGateway {
  ensureRoom(roomId: string, maxPeers: number): Promise<void>;
  removeParticipant(roomId: string, identity: string): Promise<void>;
  setParticipantMuted(roomId: string, identity: string, muted: boolean): Promise<void>;
  endRoom(roomId: string): Promise<void>;
}
