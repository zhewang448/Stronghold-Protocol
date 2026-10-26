// Adapt the reference site's communication UI to this fork's room.chat transport and moderation.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { EmoteWheel, EmoteBubble } from './emotes.js';
import { store, useStore, shallowEqual } from '../store.js';
import { net } from '../net.js';
import { chatFacts, sendChat } from './chat.js';
import { useSettings } from './settings.js';
import { describeError } from './toasts.js';
import { useAvatarMessageDock } from './hudDock.js';

export const TEXT_BUBBLE_MS = 3000;
export function avatarMessage(messages, playerId, now, enabled = true) {
  if (!enabled) return null;
  for (let i = (messages?.length || 0) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.playerId === playerId && m.role !== 'system' && Number.isFinite(m.receivedAt)
      && now >= m.receivedAt && now - m.receivedAt < TEXT_BUBBLE_MS) return m;
  }
  return null;
}

/** New player messages share the reference site's EmoteBubble geometry and timeline. */
export function AvatarMessage({ playerId, name, emote }) {
  const chat = useStore(s => s.chat);
  const settings = useSettings();
  const [, tick] = useState(0);
  const message = avatarMessage(chat?.messages, playerId, Date.now(), settings.chatBubbles);
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => tick(n => n + 1), Math.max(0, message.receivedAt + TEXT_BUBBLE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [message?.id, message?.receivedAt]);
  // Disabling notifications discards the current batch, so reenabling never replays old messages.
  const discarded = useStore(s => s.chat?.bubbleDiscardedThrough || 0);
  const text = message && message.id > discarded && (!emote?.at || message.receivedAt >= emote.at) ? message : null;
  const dock = useRef(null);
  useAvatarMessageDock(dock, playerId, text ? `chat:${text.id}` : emote?.seq);
  if (!text && !emote) return null;
  return html`<div class="team__message" ref=${dock} data-player-id=${playerId} data-author=${name || ''}>
    ${text ? html`<${EmoteBubble} key=${`chat:${chat.code}:${text.id}`} text=${text.text} at=${text.receivedAt} ttl=${TEXT_BUBBLE_MS} class="team__bubble" />`
      : html`<${EmoteBubble} key=${`emote:${emote.seq}`} id=${emote.id} at=${emote.at} class="team__bubble" />`}
  </div>`;
}

export function MatchCommunication({ open, onToggle, onSend, disabled }) {
  const state = useStore(s => ({ chat: s.chat, room: s.room, me: s.me, connection: s.connection }), shallowEqual);
  const settings = useSettings(), chat = state.chat, facts = chatFacts(state);
  const readingHistory = useRef(false);
  const available = facts.member && state.room?.textChat === true;
  useEffect(() => {
    if (!settings.chatBubbles && chat) {
      store.patch('chat', { bubbleDiscardedThrough: chat.lastId });
    }
  }, [settings.chatBubbles, chat?.lastId]);
  useEffect(() => {
    store.patch('chat', { open: false });
    return () => { store.patch('chat', { open: false }); };
  }, []);
  const history = (chat?.messages || []).map(m => ({ ...m, seq: m.id, sentAt: m.at }));
  const onReading = reading => {
    if (!reading && !readingHistory.current) return;
    readingHistory.current = reading;
    if (available && (chat.open !== reading || reading && (chat.unread || chat.previewIds.length))) {
      store.patch('chat', { open: reading, ...(reading ? { unread: 0, previewIds: [] } : {}) });
    }
  };
  return html`<${EmoteWheel} open=${open} onToggle=${onToggle} onSend=${onSend} disabled=${disabled}
    onChat=${available ? () => sendChat({ store, net }) : null} history=${history} myId=${state.me?.playerId}
    chatState=${available ? { draft: chat.draft, sending: chat.sending, unread: chat.unread, readOnly: !facts.canSend,
      reason: facts.reason, error: chat.error ? describeError(chat.error) : null,
      onDraft: draft => store.patch('chat', { draft, error: null }), onReading } : null} />`;
}
