export interface ChatMsg {
  id: number;
  senderType: "customer" | "staff" | "system" | string;
  senderName: string | null;
  kind: "text" | "image" | "system" | string;
  event: string | null;
  body: string;
  isInternal?: boolean;
  hidden: boolean;
  topic: string | null;
  context: { type: string; id: number; label: string } | null;
  attachment: { id: number; mime: string; expired: boolean } | null;
  status?: "sent" | "delivered" | "read";
  createdAt: string;
}

export interface ChatSendInput {
  body: string;
  image?: string | null;
  internal?: boolean;
  clientMsgId: string;
}

/** كل طرف (عميل/موظف) بيوصّل نفسه بالمكوّن المشترك من هنا. */
export interface ChatBackend<Meta> {
  open(signal?: AbortSignal): Promise<{ messages: ChatMsg[]; hasMore: boolean; meta: Meta }>;
  older(beforeId: number): Promise<{ messages: ChatMsg[]; hasMore: boolean }>;
  poll(after: number, signal?: AbortSignal): Promise<{ messages: ChatMsg[]; meta: Meta }>;
  send(input: ChatSendInput): Promise<{ message: ChatMsg; meta?: Meta }>;
  /** مسار الصورة (بيتحمّل بتوكن الجلسة). */
  imagePath(id: number): string;
  token(): string | undefined;
}
