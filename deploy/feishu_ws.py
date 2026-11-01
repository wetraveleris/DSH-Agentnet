import json, os, sys
import requests
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
from lark_oapi.event.callback.model.p2_card_action_trigger import P2CardActionTriggerResponse

APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
TARGET = os.environ.get("AVATAR_FEISHU_FORWARD", "http://127.0.0.1:50999/api/feishu/event")

def forward(body):
    try:
        r = requests.post(TARGET, json=body, timeout=20)
        try:
            return r.json()
        except Exception:
            return {}
    except Exception as e:
        print("forward error", e, file=sys.stderr, flush=True)
        return {}

def on_message(data: P2ImMessageReceiveV1) -> None:
    try:
        msg = data.event.message
        body = {
            "header": {"event_type": "im.message.receive_v1"},
            "event": {
                "sender": {"sender_type": getattr(getattr(data.event, "sender", None), "sender_type", "user")},
                "message": {"chat_id": msg.chat_id, "message_id": msg.message_id, "content": msg.content, "message_type": msg.message_type},
            },
        }
        print("msg", msg.message_id, msg.chat_id, flush=True)
        forward(body)
    except Exception as e:
        print("handler error", e, file=sys.stderr, flush=True)

def on_card(data) -> P2CardActionTriggerResponse:
    try:
        ev = data.event
        body = {
            "header": {"event_type": "card.action.trigger"},
            "event": {
                "action": {"value": getattr(ev.action, "value", {}) or {}},
                "context": {"open_chat_id": getattr(getattr(ev, "context", None), "open_chat_id", "")},
            },
        }
        print("card", json.dumps(body, ensure_ascii=False)[:200], flush=True)
        resp = forward(body)
        return P2CardActionTriggerResponse(resp if isinstance(resp, dict) else {})
    except Exception as e:
        print("card error", e, file=sys.stderr, flush=True)
        return P2CardActionTriggerResponse({"toast": {"type": "error", "content": str(e)}})

handler = lark.EventDispatcherHandler.builder("", "") \
    .register_p2_im_message_receive_v1(on_message) \
    .register_p2_card_action_trigger(on_card) \
    .build()
cli = lark.ws.Client(APP_ID, APP_SECRET, event_handler=handler, log_level=lark.LogLevel.INFO)
print("feishu ws starting", flush=True)
cli.start()
