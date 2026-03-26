"""
AIイノベーション推進室 チーム構成 マルチエージェントシステム

オーケストレーター + 5専門エージェントによる協調型AIアシスタント。
各専門エージェントはClaude APIのtool useで呼び出され、
オーケストレーターが回答を統合してユーザーに返す。
"""

import json
import os
from typing import Generator

import anthropic

from ai_team_prompts import (
    AGENT_LABELS,
    GOVERNANCE_AGENT_PROMPT,
    HIRING_AGENT_PROMPT,
    ORCHESTRATOR_SYSTEM_PROMPT,
    SKILLS_AGENT_PROMPT,
    STRATEGY_AGENT_PROMPT,
    TECH_AGENT_PROMPT,
)

# ─── 専門エージェント呼び出し ────────────────────────────────────────────────

def _call_specialist(
    client: anthropic.Anthropic,
    system_prompt: str,
    query: str,
) -> str:
    """専門エージェントをclaude-haiku-4-5で呼び出し、回答文字列を返す"""
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        system=system_prompt,
        messages=[{"role": "user", "content": query}],
    )
    return response.content[0].text if response.content else "回答を取得できませんでした"


# ─── ツール定義（オーケストレーター用） ────────────────────────────────────────

ORCHESTRATOR_TOOLS = [
    {
        "name": "consult_strategy_agent",
        "description": (
            "AI戦略エージェントに相談する。"
            "AI活用ロードマップ、Ambient移行計画、KPI設計、全社展開戦略など"
            "戦略・計画に関する質問に答える。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "戦略エージェントへの具体的な質問・依頼内容",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "consult_hiring_agent",
        "description": (
            "採用設計エージェントに相談する。"
            "ポジション定義、採用要件、チーム編成、内部登用 vs 外部採用の判断など"
            "採用・組織設計に関する質問に答える。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "採用エージェントへの具体的な質問・依頼内容",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "consult_skills_agent",
        "description": (
            "スキルアセスメントエージェントに相談する。"
            "必要スキルの可視化、スキルギャップ分析、育成プログラム設計など"
            "スキル評価・人材育成に関する質問に答える。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "スキルエージェントへの具体的な質問・依頼内容",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "consult_governance_agent",
        "description": (
            "ガバナンスエージェントに相談する。"
            "AIガバナンスポリシー、セキュリティリスク管理、コンプライアンス対応、"
            "承認フロー設計など安全・ガバナンスに関する質問に答える。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "ガバナンスエージェントへの具体的な質問・依頼内容",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "consult_tech_agent",
        "description": (
            "技術・Ambientエージェントに相談する。"
            "技術スタック選定、AI基盤設計、データ基盤、MLOps、"
            "Ambient AIアーキテクチャなど技術面の質問に答える。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "技術エージェントへの具体的な質問・依頼内容",
                }
            },
            "required": ["query"],
        },
    },
]

# ─── ツール実行マップ ─────────────────────────────────────────────────────────

def _execute_tool(
    client: anthropic.Anthropic,
    tool_name: str,
    tool_input: dict,
) -> str:
    """ツール名に応じて専門エージェントを呼び出す"""
    query = tool_input.get("query", "")
    prompt_map = {
        "consult_strategy_agent": STRATEGY_AGENT_PROMPT,
        "consult_hiring_agent": HIRING_AGENT_PROMPT,
        "consult_skills_agent": SKILLS_AGENT_PROMPT,
        "consult_governance_agent": GOVERNANCE_AGENT_PROMPT,
        "consult_tech_agent": TECH_AGENT_PROMPT,
    }
    system_prompt = prompt_map.get(tool_name)
    if not system_prompt:
        return f"不明なツール: {tool_name}"

    agent_label = AGENT_LABELS.get(tool_name.replace("consult_", "").replace("_agent", ""), tool_name)
    result = _call_specialist(client, system_prompt, query)
    return f"[{agent_label}の回答]\n{result}"


# ─── マルチエージェントループ（ストリーミング） ──────────────────────────────

def stream_team_agent(
    api_key: str,
    messages: list[dict],
) -> Generator[str, None, None]:
    """
    オーケストレーターがユーザーメッセージを受け取り、
    必要な専門エージェントを呼び出して回答をSSEストリームで返す。

    SSEイベント形式:
      {"type": "agent_call", "agent": "...", "query": "..."}   - エージェント呼び出し通知
      {"type": "agent_result", "agent": "...", "result": "..."} - エージェント結果受信
      {"type": "text", "text": "..."}                          - 最終回答テキスト
      {"type": "done"}                                         - 完了
      {"type": "error", "message": "..."}                      - エラー
    """
    client = anthropic.Anthropic(api_key=api_key)

    api_messages = [{"role": m["role"], "content": m["content"]} for m in messages]

    try:
        # アジェンティックループ
        while True:
            response = client.messages.create(
                model="claude-opus-4-6",
                max_tokens=2048,
                system=ORCHESTRATOR_SYSTEM_PROMPT,
                tools=ORCHESTRATOR_TOOLS,
                messages=api_messages,
            )

            # ツール呼び出しを処理
            if response.stop_reason == "tool_use":
                tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
                tool_results = []

                for tool_block in tool_use_blocks:
                    tool_name = tool_block.name
                    tool_input = tool_block.input
                    agent_key = tool_name.replace("consult_", "").replace("_agent", "")
                    agent_label = AGENT_LABELS.get(agent_key, tool_name)

                    # エージェント呼び出し通知をSSEで送信
                    yield f"data: {json.dumps({'type': 'agent_call', 'agent': agent_label, 'query': tool_input.get('query', '')}, ensure_ascii=False)}\n\n"

                    # 専門エージェント実行
                    result = _execute_tool(client, tool_name, tool_input)

                    # エージェント結果通知をSSEで送信
                    yield f"data: {json.dumps({'type': 'agent_result', 'agent': agent_label, 'result': result}, ensure_ascii=False)}\n\n"

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_block.id,
                        "content": result,
                    })

                # アシスタントの応答とツール結果をメッセージに追加してループ継続
                api_messages.append({"role": "assistant", "content": response.content})
                api_messages.append({"role": "user", "content": tool_results})

            else:
                # ツール呼び出しなし（最終回答）→ response.content のテキストをそのまま返す
                for block in response.content:
                    if block.type == "text" and block.text:
                        yield f"data: {json.dumps({'type': 'text', 'text': block.text}, ensure_ascii=False)}\n\n"

                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                break

    except anthropic.APIError as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
