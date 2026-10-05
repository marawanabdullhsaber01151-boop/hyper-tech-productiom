/** @format */
/**
 * Portal chat — customer side.
 *
 * GET  /portal/chat                 فتح الشات: بيانات المحادثة + آخر الرسائل
 * GET  /portal/chat/poll?after=ID   استعلام خفيف: الجديد فقط (+ مؤشرات القراءة)
 * POST /portal/chat/messages        إرسال رسالة (نص و/أو صورة)
 * POST /portal/chat/read            تعليم الكل كمقروء
 * POST /portal/chat/rating          تقييم المحادثة بعد إغلاقها
 * GET  /portal/chat/attachments/:id تحميل صورة (بعد التحقق من الملكية)
 * GET  /portal/chat/summary         عدّاد غير المقروء للأيقونة العائمة
 */
import { Router, Request, Response, NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getChatConfig } from "../lib/chatConfig";
import { pushPublicKey } from "../lib/chatPush";
import { isWithinBusinessHours } from "../lib/chatPolicy";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import {
  chatAttachmentsTable,
  chatMessagesTable,
  chatRatingsTable,
  chatPushSubscriptionsTable,
  chatConversationsTable,
  portalCustomersTable,
} from "../db/schema";
import {
  requirePortalAuth,
  getAuthenticatedPortalCustomerId,
} from "../middleware/portal-auth";
import {
  CHAT_CONTEXT_TYPES,
  CHAT_MAX_BODY_LENGTH,
  CHAT_TOPICS,
  normalizeChatBody,
  parseChatImageDataUrl,
} from "../lib/chatPolicy";
import {
  fetchMessages,
  getEffectiveHandler,
  getOrCreateConversation,
  markCustomerRead,
  postMessage,
  resolveContext,
  serializeMessages,
  sweepEscalations,
  touchCustomerPresence,
  insertSystemMessage,
} from "../lib/chatService";

const router = Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) =>
    `chat:${(req as Request).portalCustomer?.portalCustomerId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "CHAT_RATE_LIMIT",
      message: "رسائل كثيرة في وقت قصير — استنى لحظة وحاول تاني",
    },
  },
});

const sendSchema = z.object({
  body: z.string().max(CHAT_MAX_BODY_LENGTH, "الرسالة طويلة جدًا").default(""),
  clientMsgId: z.string().uuid("معرّف الرسالة غير صالح"),
  topic: z.enum(CHAT_TOPICS).optional().nullable(),
  image: z.string().max(1_000_000).optional().nullable(),
  context: z
    .object({
      type: z.enum(CHAT_CONTEXT_TYPES),
      id: z.number().int().positive(),
    })
    .optional()
    .nullable(),
});

const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional().nullable(),
});

async function conversationMeta(
  conv: Awaited<ReturnType<typeof getOrCreateConversation>>,
) {
  const handler = await getEffectiveHandler(conv);
  const config = await getChatConfig();
  return {
    hours: {
      isOpen: isWithinBusinessHours(new Date(), config),
      openDays: config.openDays,
      openMinute: config.openMinute,
      closeMinute: config.closeMinute,
      whatsappNumber: config.whatsappNumber,
    },
    id: conv.id,
    status: conv.status,
    handlerName: handler?.name ?? null,
    unread: conv.customerUnread,
    lastMessageId: conv.lastMessageId,
    // مؤشرات لتحديث علامات التسليم/القراءة عند العميل بدون إعادة جلب الرسائل
    staffDeliveredUpTo: conv.staffLastDeliveredId,
    staffReadUpTo: conv.staffLastReadId,
  };
}

/* ───────── open ───────── */
router.get(
  "/portal/chat",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const conv = await getOrCreateConversation(customerId);
      const beforeId = Number(req.query.before) || undefined;
      const rows = await fetchMessages(conv.id, "customer", { beforeId });
      const messages = await serializeMessages(rows, conv, "customer");
      await touchCustomerPresence(conv.id);
      res.json({
        conversation: await conversationMeta(conv),
        messages,
        hasMore: rows.length >= 50,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── poll ───────── */
router.get(
  "/portal/chat/poll",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const after = Math.max(0, Number(req.query.after) || 0);
      const conv = await getOrCreateConversation(customerId);
      // Skip all other work for an idle poll: nothing new and nothing changed.
      const rows =
        conv.lastMessageId > after ?
          await fetchMessages(conv.id, "customer", { afterId: after })
        : [];
      const messages = await serializeMessages(rows, conv, "customer");
      await touchCustomerPresence(conv.id);
      void sweepEscalations().catch(() => undefined);
      res.json({
        conversation: await conversationMeta(conv),
        messages,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── summary (floating button badge) ───────── */
router.get(
  "/portal/chat/summary",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const [row] = await db
        .select({
          unread: chatConversationsTable.customerUnread,
          status: chatConversationsTable.status,
        })
        .from(chatConversationsTable)
        .where(eq(chatConversationsTable.portalCustomerId, customerId))
        .limit(1);
      res.json({ unread: row?.unread ?? 0, status: row?.status ?? "open" });
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── send ───────── */
router.post(
  "/portal/chat/messages",
  requirePortalAuth,
  sendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const data = sendSchema.parse(req.body);
      const body = normalizeChatBody(data.body);
      if (!body && !data.image) {
        res.status(400).json({ error: { message: "اكتب رسالة أو أرفق صورة" } });
        return;
      }
      const image = data.image ? parseChatImageDataUrl(data.image) : null;

      const [customer] = await db
        .select({
          fullName: portalCustomersTable.fullName,
          isActive: portalCustomersTable.isActive,
        })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, customerId))
        .limit(1);
      if (!customer || !customer.isActive) {
        res.status(403).json({ error: { message: "الحساب غير نشط" } });
        return;
      }

      const conv = await getOrCreateConversation(customerId);
      const context =
        data.context ?
          await resolveContext(customerId, data.context.type, data.context.id)
        : null;

      const result = await postMessage({
        conversation: conv,
        sender: { type: "customer", customerId, name: customer.fullName },
        body,
        image,
        topic: data.topic ?? null,
        context,
        clientMsgId: data.clientMsgId,
      });

      void sweepEscalations().catch(() => undefined);
      const [view] = await serializeMessages(
        [result.message],
        result.conversation,
        "customer",
      );
      res.status(result.duplicate ? 200 : 201).json({
        message: view,
        duplicate: result.duplicate,
        conversation: await conversationMeta(result.conversation),
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── mark read ───────── */
router.post(
  "/portal/chat/read",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const conv = await getOrCreateConversation(customerId);
      await markCustomerRead(conv.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── rating ───────── */
router.post(
  "/portal/chat/rating",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const data = ratingSchema.parse(req.body);
      const conv = await getOrCreateConversation(customerId);

      const [closure] = await db
        .select({ id: chatMessagesTable.id })
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.conversationId, conv.id),
            eq(chatMessagesTable.event, "closed"),
          ),
        )
        .orderBy(desc(chatMessagesTable.id))
        .limit(1);
      if (!closure) {
        res.status(409).json({ error: { message: "لا توجد محادثة مغلقة للتقييم" } });
        return;
      }
      const inserted = await db
        .insert(chatRatingsTable)
        .values({
          conversationId: conv.id,
          closureMessageId: closure.id,
          stars: data.stars,
          comment: data.comment?.trim() || null,
        })
        .onConflictDoNothing()
        .returning({ id: chatRatingsTable.id });
      if (!inserted.length) {
        res.status(409).json({ error: { message: "قيّمت هذه المحادثة بالفعل" } });
        return;
      }
      await insertSystemMessage(conv.id, "rated", `تقييم العميل: ${data.stars}/5`, {
        internal: true,
      });
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── attachment bytes ───────── */
router.get(
  "/portal/chat/attachments/:id",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { message: "رقم غير صحيح" } });
        return;
      }
      const [row] = await db
        .select({
          mime: chatAttachmentsTable.mime,
          data: chatAttachmentsTable.data,
          isInternal: chatMessagesTable.isInternal,
          hiddenAt: chatMessagesTable.hiddenAt,
          ownerId: chatConversationsTable.portalCustomerId,
        })
        .from(chatAttachmentsTable)
        .innerJoin(
          chatMessagesTable,
          eq(chatMessagesTable.id, chatAttachmentsTable.messageId),
        )
        .innerJoin(
          chatConversationsTable,
          eq(chatConversationsTable.id, chatAttachmentsTable.conversationId),
        )
        .where(eq(chatAttachmentsTable.id, id))
        .limit(1);
      // Same 404 for "not yours" and "doesn't exist" → no id probing.
      if (!row || row.ownerId !== customerId || row.isInternal || row.hiddenAt) {
        res.status(404).json({ error: { message: "الصورة غير موجودة" } });
        return;
      }
      if (!row.data) {
        res.status(410).json({ error: { message: "انتهت صلاحية الصورة" } });
        return;
      }
      sendImage(res, row.mime, row.data);
    } catch (err) {
      next(err);
    }
  },
);

/* ───────── Web Push (مجاني) ───────── */
const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

router.get("/portal/chat/push-key", requirePortalAuth, (_req, res) => {
  res.json({ publicKey: pushPublicKey() });
});

router.post(
  "/portal/chat/push-subscribe",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const d = subscribeSchema.parse(req.body);
      await db
        .insert(chatPushSubscriptionsTable)
        .values({ audience: "customer", portalCustomerId: customerId, userId: null, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth })
        .onConflictDoUpdate({
          target: chatPushSubscriptionsTable.endpoint,
          // نفس الجهاز قد يُستخدم بحساب آخر → ينتقل الاشتراك للحساب الحالي
          set: { audience: "customer", portalCustomerId: customerId, userId: null, p256dh: d.keys.p256dh, auth: d.keys.auth },
        });
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/chat/push-unsubscribe",
  requirePortalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getAuthenticatedPortalCustomerId(req);
      const endpoint = z.object({ endpoint: z.string().max(1000) }).parse(req.body).endpoint;
      await db
        .delete(chatPushSubscriptionsTable)
        .where(and(eq(chatPushSubscriptionsTable.endpoint, endpoint), eq(chatPushSubscriptionsTable.portalCustomerId, customerId)));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export function sendImage(res: Response, mime: string, data: Buffer) {
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Disposition", "inline");
  res.end(data);
}

export default router;
