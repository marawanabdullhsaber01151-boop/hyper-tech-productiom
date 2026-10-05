/** @format */
/**
 * Portal chat — staff side (مسؤول الحساب / مدير المبيعات / مراقبة إدارية).
 *
 * GET  /chat/inbox?filter=&q=&page=          قائمة المحادثات
 * GET  /chat/summary                          عدّادات الشارة
 * GET  /chat/conversations/:id                المحادثة + الرسائل (+ ملاحظات داخلية)
 * GET  /chat/conversations/:id/poll?after=    الجديد فقط
 * POST /chat/conversations/:id/messages       رد / ملاحظة داخلية
 * POST /chat/conversations/:id/read           تعليم كمقروء
 * POST /chat/conversations/:id/claim          استلام محادثة بلا مسؤول
 * POST /chat/conversations/:id/transfer       تحويل (مدير المبيعات)
 * POST /chat/conversations/:id/close          إغلاق
 * POST /chat/conversations/:id/reopen         إعادة فتح
 * POST /chat/messages/:id/hide                إخفاء رسالة مخالفة (مدير المبيعات)
 * GET  /chat/attachments/:id                  تحميل صورة
 * GET/POST/PATCH /chat/quick-replies          الردود الجاهزة
 */
import { Router, Request, Response, NextFunction } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import {
  chatAttachmentsTable,
  chatConversationsTable,
  chatMessagesTable,
  chatQuickRepliesTable,
  chatRatingsTable,
  chatStaffAccessTable,
  chatPushSubscriptionsTable,
  portalCustomersTable,
  systemUsersTable,
  type ChatConversation,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { writeAuditEvent } from "../lib/governance";
import {
  CHAT_MAX_BODY_LENGTH,
  CHAT_MODES,
  defaultChatModeForRole,
  effectiveChatMode,
  normalizeChatBody,
  parseChatImageDataUrl,
  resolveChatAccessByMode,
  type ChatAccess,
  type ChatMode,
} from "../lib/chatPolicy";
import {
  fetchMessages,
  getEffectiveHandler,
  insertSystemMessage,
  markStaffDelivered,
  markStaffRead,
  postMessage,
  serializeMessages,
  sweepEscalations,
  purgeExpiredAttachments,
} from "../lib/chatService";
import { getChatConfig, saveChatConfig } from "../lib/chatConfig";
import { pushPublicKey } from "../lib/chatPush";
import { mergeChatConfig, validateChatConfig, type ChatConfig } from "../lib/chatPolicy";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { notifyUser } from "../lib/notifications";
import { sendImage } from "./portal-chat";

const router = Router();

/**
 * بوابة الشات: الوضع الفعلي = تجاوز المدير (chat_staff_access) أو الافتراضي
 * من الدور. "none" ← 403. الوضع يُخزَّن على الطلب لبقية المسار.
 */
type ModedRequest = Request & { chatMode?: ChatMode };
const modeOf = (req: Request): ChatMode => (req as ModedRequest).chatMode ?? "none";

async function chatGate(req: Request, res: Response, next: NextFunction) {
  try {
    const [row] = await db
      .select({ mode: chatStaffAccessTable.mode })
      .from(chatStaffAccessTable)
      .where(eq(chatStaffAccessTable.userId, req.user!.userId))
      .limit(1);
    const mode = effectiveChatMode(req.user!.role, row?.mode);
    if (mode === "none") throw httpError(403, "ليس لديك صلاحية الوصول للمحادثات");
    (req as ModedRequest).chatMode = mode;
    next();
  } catch (err) {
    next(err);
  }
}
const staffOnly = [requireAuth, chatGate];
const managerOnly = [requireAuth, chatGate, (req: Request, _res: Response, next: NextFunction) => {
  if (modeOf(req) !== "manager") return next(httpError(403, "هذا الإجراء للمدير فقط"));
  next();
}];

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "رقم غير صحيح");
  return id;
}

/** المحادثة + المسؤول الفعلي + صلاحيات هذا المستخدم عليها. */
async function loadForStaff(req: Request, conversationId: number) {
  const [conv] = await db
    .select()
    .from(chatConversationsTable)
    .where(eq(chatConversationsTable.id, conversationId))
    .limit(1);
  if (!conv) throw httpError(404, "المحادثة غير موجودة");
  const handler = await getEffectiveHandler(conv);
  const access = resolveChatAccessByMode(
    modeOf(req),
    req.user!.userId,
    handler?.userId ?? null,
  );
  // Same message for "forbidden" and "missing" → don't leak existence.
  if (!access.canView) throw httpError(404, "المحادثة غير موجودة");
  return { conv, handler, access };
}

function requireReply(access: ChatAccess) {
  if (!access.canReply) throw httpError(403, "ليس لديك صلاحية الرد على هذه المحادثة");
}
function requireManage(access: ChatAccess) {
  if (!access.canManage) throw httpError(403, "هذا الإجراء لمدير المبيعات فقط");
}

async function auditView(req: Request, conv: ChatConversation) {
  await writeAuditEvent({
    actorUserId: req.user!.userId,
    actorName: req.user!.username,
    actionKey: "chat.view",
    resourceType: "chat_conversation",
    resourceId: conv.id,
    decision: "executed",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  }).catch(() => undefined);
}

function conversationView(
  conv: ChatConversation,
  handler: { userId: number; name: string } | null,
  access: ChatAccess,
) {
  return {
    id: conv.id,
    customerName: conv.customerName,
    customerCompany: conv.customerCompany,
    portalCustomerId: conv.portalCustomerId,
    status: conv.status,
    topic: conv.topic,
    handler,
    staffUnread: conv.staffUnread,
    lastMessageId: conv.lastMessageId,
    lastMessageAt: conv.lastMessageAt.toISOString(),
    lastMessagePreview: conv.lastMessagePreview,
    lastSenderType: conv.lastSenderType,
    awaitingStaffSince: conv.awaitingStaffSince?.toISOString() ?? null,
    escalated: conv.escalatedAt !== null,
    customerLastSeenAt: conv.customerLastSeenAt?.toISOString() ?? null,
    customerDeliveredUpTo: conv.customerLastDeliveredId,
    customerReadUpTo: conv.customerLastReadId,
    access: {
      canReply: access.canReply,
      canManage: access.canManage,
      readOnly: !access.canReply,
    },
  };
}

/* ───────── inbox ───────── */
const effectiveHandlerSql = sql<number | null>`COALESCE(${chatConversationsTable.handlerUserId}, ${portalCustomersTable.assignedSalesUserId})`;

router.get("/chat/inbox", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    void sweepEscalations().catch(() => undefined);
    const mode = modeOf(req);
    const userId = req.user!.userId;
    const filter = String(req.query.filter ?? "all");
    const q = String(req.query.q ?? "").trim().slice(0, 60);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 30;

    const isAgent = mode === "agent";

    const conditions = [] as ReturnType<typeof sql>[];
    // Agents never see other people's conversations — enforced in SQL.
    if (isAgent) {
      conditions.push(
        sql`(${effectiveHandlerSql} = ${userId} OR ${effectiveHandlerSql} IS NULL)`,
      );
    }
    if (filter === "mine") conditions.push(sql`${effectiveHandlerSql} = ${userId}`);
    else if (filter === "unassigned") conditions.push(sql`${effectiveHandlerSql} IS NULL`);
    else if (filter === "escalated")
      conditions.push(sql`${chatConversationsTable.escalatedAt} IS NOT NULL AND ${chatConversationsTable.status} = 'open'`);
    else if (filter === "unread") conditions.push(sql`${chatConversationsTable.staffUnread} > 0`);
    if (filter === "closed") conditions.push(sql`${chatConversationsTable.status} = 'closed'`);
    else conditions.push(sql`${chatConversationsTable.status} = 'open'`);
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push(
        sql`(${chatConversationsTable.customerName} ILIKE ${like} OR ${chatConversationsTable.customerCompany} ILIKE ${like})`,
      );
    }

    const handlerUser = alias(systemUsersTable, "handler_user");
    const rows = await db
      .select({
        conv: chatConversationsTable,
        handlerId: effectiveHandlerSql,
        handlerName: handlerUser.fullName,
      })
      .from(chatConversationsTable)
      .innerJoin(
        portalCustomersTable,
        eq(portalCustomersTable.id, chatConversationsTable.portalCustomerId),
      )
      .leftJoin(handlerUser, sql`${handlerUser.id} = ${effectiveHandlerSql}`)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(
        desc(sql`(${chatConversationsTable.escalatedAt} IS NOT NULL)`),
        desc(chatConversationsTable.lastMessageAt),
      )
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);

    const hasMore = rows.length > pageSize;
    res.json({
      page,
      hasMore,
      items: rows.slice(0, pageSize).map((r) => {
        const access = resolveChatAccessByMode(mode, userId, r.handlerId ?? null);
        return conversationView(
          r.conv,
          r.handlerId && r.handlerName ?
            { userId: r.handlerId, name: r.handlerName }
          : null,
          access,
        );
      }),
    });
  } catch (err) {
    next(err);
  }
});

/* ───────── summary ───────── */
router.get("/chat/summary", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const isAgent = modeOf(req) === "agent";
    const scope =
      isAgent ?
        sql`AND (COALESCE(c.handler_user_id, p.assigned_sales_user_id) = ${userId}
                 OR COALESCE(c.handler_user_id, p.assigned_sales_user_id) IS NULL)`
      : sql``;
    const result = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE c.staff_unread > 0)::int AS unread_conversations,
             COALESCE(SUM(c.staff_unread), 0)::int AS unread_messages,
             COUNT(*) FILTER (WHERE c.escalated_at IS NOT NULL)::int AS escalated
        FROM chat_conversations c
        JOIN portal_customers p ON p.id = c.portal_customer_id
       WHERE c.status = 'open' ${scope}
    `);
    const row = (result.rows[0] ?? {}) as Record<string, number>;
    res.json({
      unreadConversations: row.unread_conversations ?? 0,
      unreadMessages: row.unread_messages ?? 0,
      escalated: row.escalated ?? 0,
      mode: modeOf(req),
    });
  } catch (err) {
    next(err);
  }
});

/* ───────── open conversation ───────── */
router.get("/chat/conversations/:id", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    const { conv, handler, access } = await loadForStaff(req, id);
    const beforeId = Number(req.query.before) || undefined;
    const rows = await fetchMessages(conv.id, "staff", { beforeId });
    const messages = await serializeMessages(rows, conv, "staff");
    if (access.canReply) await markStaffDelivered(conv.id);
    if (access.mustAudit && !beforeId) await auditView(req, conv);

    const [rating] = await db
      .select({ stars: chatRatingsTable.stars, comment: chatRatingsTable.comment })
      .from(chatRatingsTable)
      .where(eq(chatRatingsTable.conversationId, conv.id))
      .orderBy(desc(chatRatingsTable.id))
      .limit(1);

    res.json({
      conversation: conversationView(conv, handler, access),
      messages,
      hasMore: rows.length >= 50,
      lastRating: rating ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/chat/conversations/:id/poll", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    const after = Math.max(0, Number(req.query.after) || 0);
    const { conv, handler, access } = await loadForStaff(req, id);
    const rows =
      conv.lastMessageId > after || after === 0 ?
        await fetchMessages(conv.id, "staff", { afterId: after })
      : [];
    const messages = await serializeMessages(rows, conv, "staff");
    if (access.canReply) await markStaffDelivered(conv.id);
    res.json({ conversation: conversationView(conv, handler, access), messages });
  } catch (err) {
    next(err);
  }
});

/* ───────── send ───────── */
const staffSendSchema = z.object({
  body: z.string().max(CHAT_MAX_BODY_LENGTH).default(""),
  clientMsgId: z.string().uuid(),
  internal: z.boolean().optional().default(false),
  image: z.string().max(1_000_000).optional().nullable(),
});

router.post("/chat/conversations/:id/messages", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    const data = staffSendSchema.parse(req.body);
    const { conv, access } = await loadForStaff(req, id);
    requireReply(access);
    const body = normalizeChatBody(data.body);
    if (!body && !data.image) throw httpError(400, "اكتب رسالة أو أرفق صورة");
    if (conv.status === "closed" && !data.internal) {
      throw httpError(409, "المحادثة مغلقة — أعد فتحها أولًا");
    }
    const image = data.image ? parseChatImageDataUrl(data.image) : null;
    if (image && data.internal) throw httpError(400, "الملاحظة الداخلية نصية فقط");

    const [me] = await db
      .select({ fullName: systemUsersTable.fullName })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, req.user!.userId))
      .limit(1);

    const result = await postMessage({
      conversation: conv,
      sender: { type: "staff", userId: req.user!.userId, name: me?.fullName ?? req.user!.username },
      body,
      image,
      isInternal: data.internal,
      clientMsgId: data.clientMsgId,
      claim: access.replyClaims && !data.internal,
    });
    const [view] = await serializeMessages([result.message], result.conversation, "staff");
    res.status(result.duplicate ? 200 : 201).json({ message: view, duplicate: result.duplicate });
  } catch (err) {
    next(err);
  }
});

router.post("/chat/conversations/:id/read", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { conv, access } = await loadForStaff(req, parseId(req.params.id));
    // Observers (read-only) must not generate read receipts to the customer.
    if (access.canReply) await markStaffRead(conv.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ───────── claim / transfer ───────── */
router.post("/chat/conversations/:id/claim", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { conv, handler, access } = await loadForStaff(req, parseId(req.params.id));
    requireReply(access);
    if (handler && handler.userId !== req.user!.userId && !access.canManage) {
      throw httpError(409, "المحادثة لها مسؤول بالفعل");
    }
    const [me] = await db
      .select({ fullName: systemUsersTable.fullName })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, req.user!.userId))
      .limit(1);
    await db
      .update(chatConversationsTable)
      .set({ handlerUserId: req.user!.userId })
      .where(eq(chatConversationsTable.id, conv.id));
    await insertSystemMessage(conv.id, "claimed", `استلم المحادثة: ${me?.fullName ?? req.user!.username}`, { internal: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const transferSchema = z.object({ toUserId: z.number().int().positive() });

router.post("/chat/conversations/:id/transfer", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { conv, access } = await loadForStaff(req, parseId(req.params.id));
    requireManage(access);
    const { toUserId } = transferSchema.parse(req.body);
    const [target] = await db
      .select({ id: systemUsersTable.id, name: systemUsersTable.fullName, role: systemUsersTable.role, status: systemUsersTable.status, override: chatStaffAccessTable.mode })
      .from(systemUsersTable)
      .leftJoin(chatStaffAccessTable, eq(chatStaffAccessTable.userId, systemUsersTable.id))
      .where(eq(systemUsersTable.id, toUserId))
      .limit(1);
    const targetMode = target ? effectiveChatMode(target.role, target.override) : "none";
    if (!target || target.status !== "active" || (targetMode !== "agent" && targetMode !== "manager")) {
      throw httpError(400, "الموظف المختار لا يمكنه استلام محادثات");
    }
    await db
      .update(chatConversationsTable)
      .set({
        handlerUserId: target.id,
        // The new owner starts a fresh SLA window.
        escalatedAt: null,
        awaitingStaffSince: conv.awaitingStaffSince ? new Date() : null,
      })
      .where(eq(chatConversationsTable.id, conv.id));
    await insertSystemMessage(conv.id, "transferred", `تم تحويل المحادثة إلى ${target.name}`, { internal: true });
    await notifyUser(target.id, {
      type: "chat_transferred",
      title: "تم تحويل محادثة إليك",
      body: `${conv.customerName}`,
      referenceType: "chat_conversation",
      referenceId: conv.id,
    });
    res.json({ ok: true, handler: { userId: target.id, name: target.name } });
  } catch (err) {
    next(err);
  }
});

/** قائمة الموظفين المتاحين للتحويل (وضع مدير فقط). */
router.get("/chat/assignable-users", ...managerOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await db
      .select({ id: systemUsersTable.id, name: systemUsersTable.fullName, role: systemUsersTable.role, override: chatStaffAccessTable.mode })
      .from(systemUsersTable)
      .leftJoin(chatStaffAccessTable, eq(chatStaffAccessTable.userId, systemUsersTable.id))
      .where(eq(systemUsersTable.status, "active"))
      .orderBy(asc(systemUsersTable.fullName));
    res.json(
      users
        .filter((u) => ["agent", "manager"].includes(effectiveChatMode(u.role, u.override)))
        .map(({ id, name, role }) => ({ id, name, role })),
    );
  } catch (err) {
    next(err);
  }
});

/* ───────── close / reopen ───────── */
router.post("/chat/conversations/:id/close", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { conv, access } = await loadForStaff(req, parseId(req.params.id));
    requireReply(access);
    if (conv.status === "closed") throw httpError(409, "المحادثة مغلقة بالفعل");
    await db
      .update(chatConversationsTable)
      .set({
        status: "closed",
        closedAt: new Date(),
        awaitingStaffSince: null,
        escalatedAt: null,
        staffUnread: 0,
      })
      .where(eq(chatConversationsTable.id, conv.id));
    // visible to the customer → this is the message the rating attaches to
    const msg = await insertSystemMessage(
      conv.id,
      "closed",
      "تم إغلاق هذه المحادثة. يسعدنا تقييم تجربتك، ويمكنك مراسلتنا في أي وقت.",
      { bump: true },
    );
    await db
      .update(chatConversationsTable)
      .set({ customerUnread: sql`${chatConversationsTable.customerUnread} + 1` })
      .where(eq(chatConversationsTable.id, conv.id));
    await notifyPortalCustomer(conv.portalCustomerId, {
      type: "portal_chat_closed",
      title: "تم إغلاق محادثتك",
      body: "قيّم تجربتك مع فريق المبيعات.",
      referenceType: "chat",
      referenceId: conv.id,
    }).catch(() => undefined);
    res.json({ ok: true, closureMessageId: msg.id });
  } catch (err) {
    next(err);
  }
});

router.post("/chat/conversations/:id/reopen", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { conv, access } = await loadForStaff(req, parseId(req.params.id));
    requireReply(access);
    if (conv.status !== "closed") throw httpError(409, "المحادثة مفتوحة بالفعل");
    await db
      .update(chatConversationsTable)
      .set({ status: "open", closedAt: null })
      .where(eq(chatConversationsTable.id, conv.id));
    await insertSystemMessage(conv.id, "reopened", "أُعيد فتح المحادثة.", { internal: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ───────── hide a violating message (manager) ───────── */
const hideSchema = z.object({ reason: z.string().min(3).max(300) });

router.post("/chat/messages/:id/hide", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = parseId(req.params.id);
    const { reason } = hideSchema.parse(req.body);
    const [msg] = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.id, messageId))
      .limit(1);
    if (!msg) throw httpError(404, "الرسالة غير موجودة");
    const { access } = await loadForStaff(req, msg.conversationId);
    requireManage(access);
    if (msg.senderType === "system") throw httpError(400, "لا يمكن إخفاء رسائل النظام");
    await db
      .update(chatMessagesTable)
      .set({ hiddenAt: new Date(), hiddenByUserId: req.user!.userId, hiddenReason: reason })
      .where(and(eq(chatMessagesTable.id, messageId), isNull(chatMessagesTable.hiddenAt)));
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "chat.hide_message",
      resourceType: "chat_message",
      resourceId: messageId,
      reason,
      decision: "executed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    }).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ───────── attachment bytes ───────── */
router.get("/chat/attachments/:id", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    const [row] = await db
      .select({
        mime: chatAttachmentsTable.mime,
        data: chatAttachmentsTable.data,
        conversationId: chatAttachmentsTable.conversationId,
      })
      .from(chatAttachmentsTable)
      .where(eq(chatAttachmentsTable.id, id))
      .limit(1);
    if (!row) throw httpError(404, "الصورة غير موجودة");
    await loadForStaff(req, row.conversationId); // access check
    if (!row.data) throw httpError(410, "انتهت صلاحية الصورة");
    sendImage(res, row.mime, row.data);
  } catch (err) {
    next(err);
  }
});

/* ───────── quick replies ───────── */
router.get("/chat/quick-replies", ...staffOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(
      await db
        .select()
        .from(chatQuickRepliesTable)
        .where(eq(chatQuickRepliesTable.isActive, true))
        .orderBy(asc(chatQuickRepliesTable.id)),
    );
  } catch (err) {
    next(err);
  }
});

const quickReplySchema = z.object({
  title: z.string().min(2).max(40),
  body: z.string().min(2).max(CHAT_MAX_BODY_LENGTH),
});

router.post("/chat/quick-replies", ...managerOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = quickReplySchema.parse(req.body);
    const [row] = await db
      .insert(chatQuickRepliesTable)
      .values({ ...data, createdByUserId: req.user!.userId })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.patch("/chat/quick-replies/:id", ...managerOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    const data = quickReplySchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const [row] = await db
      .update(chatQuickRepliesTable)
      .set(data)
      .where(eq(chatQuickRepliesTable.id, id))
      .returning();
    if (!row) throw httpError(404, "الرد الجاهز غير موجود");
    res.json(row);
  } catch (err) {
    next(err);
  }
});

/* ───────── إعدادات الشات (يحددها المدير) ───────── */
router.get("/chat/settings", ...staffOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getChatConfig());
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({
  openDays: z.array(z.number().int().min(0).max(6)).max(7),
  openMinute: z.number().int(),
  closeMinute: z.number().int(),
  escalationMinutes: z.number().int(),
  autoReplyEnabled: z.boolean(),
  autoReplyText: z.string().max(500),
  holidays: z.array(z.string()).max(400),
  whatsappNumber: z.string().max(20).nullable().optional(),
});

router.put("/chat/settings", ...managerOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = settingsSchema.parse(req.body);
    const config: ChatConfig = mergeChatConfig({
      ...parsed,
      openDays: [...new Set(parsed.openDays)].sort((a, b) => a - b),
      holidays: [...new Set(parsed.holidays)].sort(),
      whatsappNumber: parsed.whatsappNumber?.trim() || null,
    });
    const error = validateChatConfig(config);
    if (error) throw httpError(400, error);
    await saveChatConfig(config, req.user!.userId);
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "chat.settings",
      resourceType: "chat_settings",
      resourceId: 1,
      decision: "executed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    }).catch(() => undefined);
    res.json(config);
  } catch (err) {
    next(err);
  }
});

/* ───────── Web Push للموظف ───────── */
const staffSubscribeSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
router.get("/chat/push-key", ...staffOnly, (_req: Request, res: Response) => {
  res.json({ publicKey: pushPublicKey() });
});
router.post("/chat/push-subscribe", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = staffSubscribeSchema.parse(req.body);
    await db
      .insert(chatPushSubscriptionsTable)
      .values({ audience: "staff", userId: req.user!.userId, portalCustomerId: null, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth })
      .onConflictDoUpdate({
        target: chatPushSubscriptionsTable.endpoint,
        set: { audience: "staff", userId: req.user!.userId, portalCustomerId: null, p256dh: d.keys.p256dh, auth: d.keys.auth },
      });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router.post("/chat/push-unsubscribe", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoint = z.object({ endpoint: z.string().max(1000) }).parse(req.body).endpoint;
    await db
      .delete(chatPushSubscriptionsTable)
      .where(and(eq(chatPushSubscriptionsTable.endpoint, endpoint), eq(chatPushSubscriptionsTable.userId, req.user!.userId)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ───────── cron (Vercel Cron يرسل Authorization: Bearer $CRON_SECRET) ───────── */
router.get("/chat/cron/maintenance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw httpError(503, "CRON_SECRET غير مضبوط");
    if (req.get("authorization") !== `Bearer ${secret}`) throw httpError(401, "غير مصرح");
    const purged = await purgeExpiredAttachments();
    const escalated = await sweepEscalations(true);
    res.json({ purgedAttachments: purged, escalated });
  } catch (err) {
    next(err);
  }
});

/* ───────── من يرد على العملاء (يحدده المدير) ───────── */
router.get("/chat/staff-access", ...managerOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await db
      .select({ id: systemUsersTable.id, name: systemUsersTable.fullName, role: systemUsersTable.role, override: chatStaffAccessTable.mode })
      .from(systemUsersTable)
      .leftJoin(chatStaffAccessTable, eq(chatStaffAccessTable.userId, systemUsersTable.id))
      .where(eq(systemUsersTable.status, "active"))
      .orderBy(asc(systemUsersTable.fullName));
    res.json({
      modes: CHAT_MODES,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        defaultMode: defaultChatModeForRole(u.role),
        override: u.override ?? null,
        effectiveMode: effectiveChatMode(u.role, u.override),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const staffAccessSchema = z.object({ mode: z.enum(CHAT_MODES).nullable() });

router.put("/chat/staff-access/:userId", ...managerOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseId(req.params.userId);
    const { mode } = staffAccessSchema.parse(req.body);
    if (userId === req.user!.userId) {
      throw httpError(400, "لا يمكنك تعديل صلاحيتك أنت — اطلب من مدير آخر");
    }
    const [target] = await db
      .select({ id: systemUsersTable.id })
      .from(systemUsersTable)
      .where(eq(systemUsersTable.id, userId))
      .limit(1);
    if (!target) throw httpError(404, "المستخدم غير موجود");
    if (mode === null) {
      await db.delete(chatStaffAccessTable).where(eq(chatStaffAccessTable.userId, userId));
    } else {
      await db
        .insert(chatStaffAccessTable)
        .values({ userId, mode, updatedByUserId: req.user!.userId })
        .onConflictDoUpdate({
          target: chatStaffAccessTable.userId,
          set: { mode, updatedByUserId: req.user!.userId, updatedAt: new Date() },
        });
    }
    await writeAuditEvent({
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: "chat.staff_access",
      resourceType: "system_user",
      resourceId: userId,
      decision: "executed",
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    }).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ───────── تقارير الأداء ───────── */
router.get("/chat/reports", ...staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (modeOf(req) === "agent") throw httpError(403, "التقارير للإدارة فقط");
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400_000);

    // Response time = from a customer message that opens a waiting episode
    // (previous visible message wasn't from the customer) to the next
    // staff reply. Wall-clock minutes.
    const episodes = await db.execute(sql`
      WITH msgs AS (
        SELECT id, conversation_id, sender_type, sender_user_id, created_at,
               LAG(sender_type) OVER (PARTITION BY conversation_id ORDER BY id) AS prev_type
          FROM chat_messages
         WHERE kind <> 'system' AND is_internal = false AND hidden_at IS NULL
      ), starts AS (
        SELECT * FROM msgs
         WHERE sender_type = 'customer' AND (prev_type IS DISTINCT FROM 'customer')
           AND created_at >= ${since}
      ), answered AS (
        SELECT s.id, s.created_at AS asked_at, r.sender_user_id, r.created_at AS replied_at
          FROM starts s
          LEFT JOIN LATERAL (
            SELECT m.sender_user_id, m.created_at FROM msgs m
             WHERE m.conversation_id = s.conversation_id AND m.id > s.id AND m.sender_type = 'staff'
             ORDER BY m.id LIMIT 1
          ) r ON true
      )
      SELECT sender_user_id, GROUPING(sender_user_id)::int AS is_total,
             COUNT(*)::int AS episodes,
             COUNT(replied_at)::int AS answered,
             ROUND(AVG(EXTRACT(EPOCH FROM (replied_at - asked_at)) / 60)::numeric, 1) AS avg_minutes,
             ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (replied_at - asked_at)) / 60))::numeric, 1) AS median_minutes
        FROM answered GROUP BY ROLLUP (sender_user_id)
    `);
    const totals = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM chat_conversations WHERE status = 'open') AS open_conversations,
        (SELECT COUNT(*)::int FROM chat_conversations WHERE status = 'closed') AS closed_conversations,
        (SELECT COUNT(*)::int FROM chat_conversations WHERE escalated_at >= ${since}) AS escalations,
        (SELECT COUNT(*)::int FROM chat_messages WHERE sender_type = 'customer' AND created_at >= ${since}) AS customer_messages,
        (SELECT COUNT(*)::int FROM chat_messages WHERE sender_type = 'staff' AND is_internal = false AND created_at >= ${since}) AS staff_messages,
        (SELECT ROUND(AVG(stars)::numeric, 2) FROM chat_ratings WHERE created_at >= ${since}) AS avg_stars,
        (SELECT COUNT(*)::int FROM chat_ratings WHERE created_at >= ${since}) AS ratings_count
    `);
    const dist = await db.execute(sql`
      SELECT stars, COUNT(*)::int AS n FROM chat_ratings WHERE created_at >= ${since} GROUP BY stars ORDER BY stars
    `);
    const names = await db
      .select({ id: systemUsersTable.id, name: systemUsersTable.fullName })
      .from(systemUsersTable);
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    type Ep = { is_total: number; sender_user_id: number | null; episodes: number; answered: number; avg_minutes: string | null; median_minutes: string | null };
    const rows = episodes.rows as Ep[];
    const overall = rows.find((r) => r.is_total === 1);
    res.json({
      days,
      totals: totals.rows[0] ?? {},
      ratingDistribution: dist.rows,
      responseTime: {
        overall: overall ?? null,
        perAgent: rows
          .filter((r) => r.is_total === 0 && r.sender_user_id !== null)
          .map((r) => ({ ...r, name: nameOf.get(r.sender_user_id as number) ?? "—" })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
