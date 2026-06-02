# DesktopMinion

Meet **Byte** — a tiny pixel-art robot who lives in the corner of your Mac and keeps you honest.

Byte watches your markdown todo files in real time and pops up with short, in-character AI-generated nudges to keep you on track. Overdue tasks? Byte notices. Been procrastinating? Byte will let you know. Crushed your list? Byte is genuinely pleased.

## What it does

- Floats above all windows, on every Space, always out of the way
- Reads your local markdown todo files (`- [ ]` / `- [x]`) live from disk
- Speaks unprompted on a configurable timer using the Anthropic API
- Click-through by default — hover to interact, click Byte to see your task summary

## Stack

Electron + plain JavaScript + Anthropic API (`claude-haiku-4-5`). No bundler, no framework, no fuss.

## Getting started

```bash
npm install
npm start
```

Add your `ANTHROPIC_API_KEY` to a `.env` file in the project root, and point `config.json` at your todo file. That's it.
