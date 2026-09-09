// Domain models shared across modules.
export type Role = 'host' | 'speaker' | 'listener';

export interface User {
  id: string;
  name: string;
  guest: boolean;
}

export interface Room {
  id: string;
  openMic: boolean;
  maxPeers: number;
}

export interface Participant {
  roomId: string;
  userId: string;
  name: string;
  guest: boolean;
  role: Role;
  muted: boolean;
  handRaised: boolean;
}

/** Public shape sent to realtime clients (protocol-compatible with v1 mesh app). */
export interface PeerView {
  id: string;
  name: string;
  guest: boolean;
  muted: boolean;
}
