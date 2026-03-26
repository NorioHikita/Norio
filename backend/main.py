"""
コンサルティング分析システム - FastAPI バックエンド

ERP・データ統合基盤・ビジネスプロセスに関する相談の
ヒヤリング〜As-Is分析〜To-Be策定〜改善提案を支援する
"""

import json
import os
from pathlib import Path
from typing import Optional

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from consulting_prompts import PHASE_LABELS, REPORT_SYSTEM_PROMPT, build_system_prompt

# プロジェクトルートの .env を優先、次にシステム環境変数を使用
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv()  # fallback: カレントディレクトリの .env

app = FastAPI(title="コンサルティング分析システム", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── リクエスト/レスポンス モデル ────────────────────────────────────────────

class MessageItem(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[MessageItem]
    phase: str = "intake"


class PhaseTransitionRequest(BaseModel):
    messages: list[MessageItem]
    current_phase: str


class ReportRequest(BaseModel):
    messages: list[MessageItem]


# ─── 起動時チェック ──────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_check():
    key = os.getenv("ANTHROPIC_API_KEY")
    if key:
        print(f"[OK] ANTHROPIC_API_KEY が設定されています (先頭8文字: {key[:8]}...)")
    else:
        print("[ERROR] ANTHROPIC_API_KEY が設定されていません。")
        print("        プロジェクトルートに .env ファイルを作成し、")
        print("        ANTHROPIC_API_KEY=sk-ant-... を記入してください。")


# ─── ヘルスチェック ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    has_key = bool(os.getenv("ANTHROPIC_API_KEY"))
    return {"status": "ok", "phases": PHASE_LABELS, "api_key_set": has_key}


# ─── チャット（ストリーミング） ───────────────────────────────────────────────

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    現在のフェーズに応じたシステムプロンプトでClaude APIを呼び出し、
    SSEストリームで応答を返す。エラーもSSE形式で返すことでフロントエンドが
    必ずメッセージを受け取れるようにする。
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")

    def generate():
        try:
            if not api_key:
                msg = (
                    "⚠️ **APIキーが設定されていません**\n\n"
                    "プロジェクトルート（`backend/` フォルダの1つ上）に `.env` ファイルを作成し、"
                    "以下を記入してください：\n\n"
                    "```\nANTHROPIC_API_KEY=sk-ant-xxxxxxxx\n```\n\n"
                    "APIキーは https://console.anthropic.com/ で取得できます。"
                )
                yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return

            client = anthropic.Anthropic(api_key=api_key)
            system_prompt = build_system_prompt(request.phase)
            messages = [{"role": m.role, "content": m.content} for m in request.messages]

            with client.messages.stream(
                model="claude-opus-4-6",
                max_tokens=2048,
                system=system_prompt,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except anthropic.AuthenticationError:
            msg = "⚠️ **APIキーが無効です。** `.env` ファイルのキーを確認してください。"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.APIConnectionError as e:
            msg = f"⚠️ **Anthropic APIへの接続に失敗しました。**\nネットワーク接続またはプロキシ設定を確認してください。\n\n詳細: `{type(e).__name__}: {e}`"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.APIError as e:
            msg = f"⚠️ **APIエラーが発生しました:** `{type(e).__name__}: {e}`"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            # 予期しない例外もSSEで返すことで接続が突然切れないようにする
            import traceback
            tb = traceback.format_exc()
            print(f"[ERROR] generate() 内で予期しない例外:\n{tb}")
            msg = f"⚠️ **予期しないエラーが発生しました:** `{type(e).__name__}: {e}`"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─── フェーズ移行の提案 ───────────────────────────────────────────────────────

@app.post("/api/suggest-phase-transition")
async def suggest_phase_transition(request: PhaseTransitionRequest):
    """
    会話内容を分析し、次フェーズへの移行が適切かどうかを判定する
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return {"should_transition": False, "next_phase": None, "reason": "APIキー未設定"}

    client = anthropic.Anthropic(api_key=api_key)

    phase_order = ["intake", "deep_dive", "asis", "tobe", "proposals"]
    current_index = phase_order.index(request.current_phase) if request.current_phase in phase_order else 0
    if current_index >= len(phase_order) - 1:
        return {"should_transition": False, "next_phase": None, "reason": "最終フェーズです"}

    next_phase = phase_order[current_index + 1]
    conversation_text = "\n".join(
        [f"{'相談者' if m.role == 'user' else 'コンサルタント'}: {m.content}" for m in request.messages[-10:]]
    )

    transition_criteria = {
        "intake": "相談者の部署・役割・問題の概要・ビジネス影響が把握できている",
        "deep_dive": "根本原因の仮説が1つ以上立てられる十分な情報が収集できている",
        "asis": "As-Is分析を提示し、相談者が内容に合意している",
        "tobe": "To-Beビジョン・KPI・制約条件が明確になっている",
    }

    criteria = transition_criteria.get(request.current_phase, "")
    check_prompt = f"""
以下のコンサルティング会話を分析してください。

現在のフェーズ: {PHASE_LABELS.get(request.current_phase, request.current_phase)}
次のフェーズ: {PHASE_LABELS.get(next_phase, next_phase)}
移行条件: {criteria}

最近の会話:
{conversation_text}

移行条件を満たしているかどうかをJSON形式で回答してください:
{{"should_transition": true/false, "confidence": 0.0-1.0, "reason": "理由を1文で"}}

JSONのみ出力してください。
"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        messages=[{"role": "user", "content": check_prompt}],
    )

    try:
        result = json.loads(response.content[0].text.strip())
        result["next_phase"] = next_phase
        result["next_phase_label"] = PHASE_LABELS.get(next_phase, next_phase)
        return result
    except (json.JSONDecodeError, IndexError, KeyError):
        return {"should_transition": False, "next_phase": next_phase, "reason": "判定できませんでした"}


# ─── レポート生成 ─────────────────────────────────────────────────────────────

@app.post("/api/generate-report")
async def generate_report(request: ReportRequest):
    """
    会話履歴全体からコンサルティングレポートを生成する（Markdown形式）
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    conversation_text = "\n\n".join(
        [f"【{'相談者' if m.role == 'user' else 'コンサルタント'}】\n{m.content}" for m in request.messages]
    )

    def generate():
        try:
            if not api_key:
                msg = "⚠️ APIキーが設定されていません。`.env` ファイルに `ANTHROPIC_API_KEY` を設定してください。"
                yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return

            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model="claude-opus-4-6",
                max_tokens=4096,
                system=REPORT_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": f"以下のコンサルティング会話からレポートを作成してください:\n\n{conversation_text}",
                    }
                ],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except anthropic.AuthenticationError:
            msg = "⚠️ **APIキーが無効です。** `.env` ファイルのキーを確認してください。"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.APIConnectionError as e:
            msg = f"⚠️ **Anthropic APIへの接続に失敗しました。**\nネットワーク接続を確認してください。\n\n詳細: `{type(e).__name__}: {e}`"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.APIError as e:
            msg = f"⚠️ APIエラー: `{type(e).__name__}: {e}`"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            import traceback
            print(f"[ERROR] generate_report() 内で予期しない例外:\n{traceback.format_exc()}")
            msg = f"⚠️ **予期しないエラー:** `{type(e).__name__}: {e}`"
            yield f"data: {json.dumps({'type': 'text', 'text': msg}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── 静的ファイル配信 ─────────────────────────────────────────────────────────

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
