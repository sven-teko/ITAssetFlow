export function newBookingId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const s=[...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export type Withdrawal = {
  action: "archive" | "assets";
  reason?: import("./archiveApi").ArchiveReason;
  target_location_id?: number; target_condition?: string; target_status?: string;
  units?: {asset_tag: string;serial_number: string | null;mac_address: string | null}[];
  note?: string;
};
export type WithdrawalSubmission = { request_id: string; quantity: number; expected_quantity: number; withdrawal: Withdrawal };
