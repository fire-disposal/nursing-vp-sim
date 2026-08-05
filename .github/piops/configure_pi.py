#!/usr/bin/env python3
"""Write an ephemeral Pi models.json for an OpenAI-compatible DeepSeek endpoint."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    payload = {
        "providers": {
            "piops-deepseek": {
                "baseUrl": args.base_url.rstrip("/"),
                "api": "openai-completions",
                "apiKey": "$DEEPSEEK_API_KEY",
                "authHeader": True,
                "models": [
                    {
                        "id": args.model,
                        "name": f"PiOps {args.model}",
                        "input": ["text"],
                        "reasoning": True,
                        "contextWindow": 128000,
                        "maxTokens": 16384,
                    }
                ],
            }
        }
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
